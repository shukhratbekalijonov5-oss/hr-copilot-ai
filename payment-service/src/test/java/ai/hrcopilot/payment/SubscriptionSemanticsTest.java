package ai.hrcopilot.payment;

import static org.assertj.core.api.Assertions.assertThat;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ai.hrcopilot.payment.domain.Plan;
import ai.hrcopilot.payment.domain.entity.Subscription;
import ai.hrcopilot.payment.repository.CustomerBillingAccountRepository;
import ai.hrcopilot.payment.repository.SubscriptionRepository;
import ai.hrcopilot.payment.service.EntitlementService;
import ai.hrcopilot.payment.service.PlanSwitchService;
import ai.hrcopilot.payment.service.SubscriptionService;
import ai.hrcopilot.payment.support.IntegrationTestBase;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Period semantics: an upgrade is immediate; a downgrade and a cancellation
 * land at the period boundary the user already paid through.
 */
class SubscriptionSemanticsTest extends IntegrationTestBase {

    @Autowired
    private PlanSwitchService planSwitch;

    @Autowired
    private SubscriptionService subscriptions;

    @Autowired
    private EntitlementService entitlements;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private CustomerBillingAccountRepository accounts;

    @Autowired
    private SubscriptionRepository subscriptionRows;

    private Subscription subscriptionOf(String userId) {
        var account = accounts.findByUserId(userId).orElseThrow();
        return subscriptionRows.findByBillingAccountId(account.getId()).orElseThrow();
    }

    private void moveColumnIntoThePast(String userId, String column) {
        jdbc.update(
                "UPDATE subscriptions SET " + column + " = now() - interval '1 hour' "
                        + "WHERE billing_account_id = "
                        + "(SELECT id FROM customer_billing_accounts WHERE user_id = ?)",
                userId);
    }

    @Test
    void cancelAtPeriodEnd_keepsThePaidPlanUntilTheBoundary_thenFree() {
        String userId = "cancel-" + UUID.randomUUID();
        planSwitch.switchPlan(userId, Plan.MAX, "test");

        subscriptions.cancelAtPeriodEnd(userId);

        // The period the user paid for still runs: MAX is retained, and the
        // cancellation is visible as status, not as a punishment.
        EntitlementService.Entitlements during = entitlements.entitlementsFor(userId);
        assertThat(during.plan()).isEqualTo(Plan.MAX);
        assertThat(during.subscriptionStatus()).isEqualTo("CANCEL_AT_PERIOD_END");

        // The boundary passes.
        moveColumnIntoThePast(userId, "current_period_end");
        EntitlementService.Entitlements after = entitlements.entitlementsFor(userId);
        assertThat(after.plan()).isEqualTo(Plan.FREE);
        assertThat(after.capabilities()).isEmpty();
    }

    @Test
    void cancellingTwiceIsIdempotent() {
        String userId = "cancel2-" + UUID.randomUUID();
        planSwitch.switchPlan(userId, Plan.PRO, "test");
        subscriptions.cancelAtPeriodEnd(userId);
        subscriptions.cancelAtPeriodEnd(userId);
        assertThat(entitlements.entitlementsFor(userId).subscriptionStatus())
                .isEqualTo("CANCEL_AT_PERIOD_END");
    }

    @Test
    void aScheduledDowngradeHoldsTheHigherPlanUntilItIsDue() {
        String userId = "down-" + UUID.randomUUID();
        planSwitch.switchPlan(userId, Plan.MAX, "test");

        subscriptions.scheduleDowngrade(userId, Plan.PRO);

        // Not due yet: MAX stands.
        assertThat(entitlements.entitlementsFor(userId).plan()).isEqualTo(Plan.MAX);

        // Due: the pending plan applies at read time, no maintenance job needed.
        moveColumnIntoThePast(userId, "effective_at");
        EntitlementService.Entitlements after = entitlements.entitlementsFor(userId);
        assertThat(after.plan()).isEqualTo(Plan.PRO);
        assertThat(after.capabilities()).extracting(Enum::name)
                .containsExactly("INTERNAL_AI_SEARCH");
    }

    @Test
    void aDowngradeCannotGoUpOrToFree() {
        String userId = "down-guard-" + UUID.randomUUID();
        planSwitch.switchPlan(userId, Plan.PRO, "test");

        // "Downgrading" upward would be an upgrade that skips payment.
        assertThatThrownBy(() -> subscriptions.scheduleDowngrade(userId, Plan.MAX))
                .isInstanceOf(IllegalArgumentException.class);
        // Leaving paid entirely is cancellation — a separate, explicit intent.
        assertThatThrownBy(() -> subscriptions.scheduleDowngrade(userId, Plan.FREE))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(entitlements.entitlementsFor(userId).plan()).isEqualTo(Plan.PRO);
    }

    @Test
    void aFreeAccountHasNothingToCancelOrDowngrade() {
        String userId = "free-guard-" + UUID.randomUUID();
        planSwitch.switchPlan(userId, Plan.FREE, "test");

        assertThatThrownBy(() -> subscriptions.cancelAtPeriodEnd(userId))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> subscriptions.scheduleDowngrade(userId, Plan.PRO))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void renewalFailureIsDunnedWithinBoundedGraceThenGrantsNothing() {
        String userId = "pastdue-" + UUID.randomUUID();
        planSwitch.switchPlan(userId, Plan.MAX, "test");

        Subscription subscription = subscriptionOf(userId);
        subscription.markPastDue();
        subscriptionRows.save(subscription);

        // Within the grace window: dunned, not cut off — the plan stands.
        EntitlementService.Entitlements during = entitlements.entitlementsFor(userId);
        assertThat(during.plan()).isEqualTo(Plan.MAX);
        assertThat(during.subscriptionStatus()).isEqualTo("PAST_DUE");

        // Beyond period end + grace: the paid plan is NOT retained forever.
        jdbc.update(
                "UPDATE subscriptions SET current_period_end = now() - interval '8 days' "
                        + "WHERE id = ?", subscription.getId());
        EntitlementService.Entitlements after = entitlements.entitlementsFor(userId);
        assertThat(after.plan()).isEqualTo(Plan.FREE);
        assertThat(after.capabilities()).isEmpty();
    }

    @Test
    void pastDueRecoveryRenewsIntoAnActivePeriod() {
        String userId = "recover-" + UUID.randomUUID();
        planSwitch.switchPlan(userId, Plan.PRO, "test");

        Subscription subscription = subscriptionOf(userId);
        subscription.markPastDue();
        subscriptionRows.save(subscription);

        // Re-read: the optimistic version moved with the save above.
        Subscription pastDue = subscriptionOf(userId);
        Instant now = Instant.now();
        pastDue.renew(Plan.PRO, now, now.plus(30, ChronoUnit.DAYS));
        subscriptionRows.save(pastDue);

        EntitlementService.Entitlements recovered = entitlements.entitlementsFor(userId);
        assertThat(recovered.plan()).isEqualTo(Plan.PRO);
        assertThat(recovered.subscriptionStatus()).isEqualTo("ACTIVE");
    }

    @Test
    void anExpiredSubscriptionGrantsNothing() {
        String userId = "expired-" + UUID.randomUUID();
        planSwitch.switchPlan(userId, Plan.MAX, "test");

        Subscription subscription = subscriptionOf(userId);
        subscription.expire();
        subscriptionRows.save(subscription);

        EntitlementService.Entitlements after = entitlements.entitlementsFor(userId);
        assertThat(after.plan()).isEqualTo(Plan.FREE);
        assertThat(after.capabilities()).isEmpty();
        assertThat(after.subscriptionStatus()).isEqualTo("EXPIRED");
    }

    @Test
    void anUpgradeIsImmediate() {
        String userId = "up-" + UUID.randomUUID();
        planSwitch.switchPlan(userId, Plan.PRO, "test");
        planSwitch.switchPlan(userId, Plan.MAX, "test");
        assertThat(entitlements.entitlementsFor(userId).plan()).isEqualTo(Plan.MAX);
    }
}
