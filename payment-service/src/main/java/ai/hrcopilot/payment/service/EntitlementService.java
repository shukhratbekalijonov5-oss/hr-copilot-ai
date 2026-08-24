package ai.hrcopilot.payment.service;

import ai.hrcopilot.payment.domain.Capability;
import ai.hrcopilot.payment.domain.Plan;
import ai.hrcopilot.payment.domain.PlanCapabilities;
import ai.hrcopilot.payment.domain.SubscriptionStatus;
import ai.hrcopilot.payment.domain.entity.Subscription;
import ai.hrcopilot.payment.repository.CustomerBillingAccountRepository;
import ai.hrcopilot.payment.repository.SubscriptionRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What a user is entitled to RIGHT NOW — the read side of the whole service.
 *
 * ## Resolution, and the fail-closed spine
 *
 * No billing account, no subscription, an unparseable plan, an unparseable
 * status: every one of these resolves to FREE, which grants nothing. The
 * only way to hold PRO or MAX is a subscription row in a status that
 * retains it. There is no error path that answers "entitled".
 *
 * ## Which statuses retain a paid plan
 *
 *   ACTIVE                → the plan, considering a due pending change
 *   PAST_DUE              → the plan, but only within a BOUNDED grace
 *                            window (period end + 7 days): a failed renewal
 *                            is dunned, not instantly cut off — and not
 *                            paid forever either. FREE after the window.
 *   CANCEL_AT_PERIOD_END  → the plan until currentPeriodEnd, FREE after
 *   PENDING / CANCELLED / EXPIRED → FREE
 *
 * A pending plan change whose effectiveAt has passed is honored at read
 * time — the switch is visible the second it is due, not when a
 * maintenance job happens to materialize it.
 */
@Service
public class EntitlementService {

    /** How long a PAST_DUE subscription keeps its plan past the period end. */
    static final Duration PAST_DUE_GRACE = Duration.ofDays(7);

    public record Entitlements(
            String userId,
            Plan plan,
            List<Capability> capabilities,
            String subscriptionStatus,
            Instant effectiveUntil,
            long version) {
    }

    private final CustomerBillingAccountRepository accounts;
    private final SubscriptionRepository subscriptions;

    public EntitlementService(
            CustomerBillingAccountRepository accounts, SubscriptionRepository subscriptions) {
        this.accounts = accounts;
        this.subscriptions = subscriptions;
    }

    @Transactional(readOnly = true)
    public Entitlements entitlementsFor(String userId) {
        return accounts.findByUserId(userId)
                .flatMap(account -> subscriptions.findByBillingAccountId(account.getId()))
                .map(subscription -> resolve(userId, subscription))
                .orElseGet(() -> free(userId, "NONE", 0));
    }

    private Entitlements resolve(String userId, Subscription subscription) {
        Optional<SubscriptionStatus> status = SubscriptionStatus.parse(subscription.getStatusRaw());
        Optional<Plan> currentPlan = Plan.parse(subscription.getCurrentPlanRaw());
        if (status.isEmpty() || currentPlan.isEmpty()) {
            // Corrupt or from-the-future state: grants nothing, breaks nothing.
            return free(userId, "UNKNOWN", subscription.getVersion());
        }

        Instant now = Instant.now();
        Plan effective = switch (status.get()) {
            case ACTIVE -> planConsideringPending(subscription, currentPlan.get(), now);
            case PAST_DUE -> withinPastDueGrace(subscription, now)
                    ? planConsideringPending(subscription, currentPlan.get(), now)
                    : null;
            case CANCEL_AT_PERIOD_END -> withinPeriod(subscription, now) ? currentPlan.get() : null;
            case PENDING, CANCELLED, EXPIRED -> null;
        };
        if (effective == null) {
            String reported = switch (status.get()) {
                case CANCEL_AT_PERIOD_END, PAST_DUE -> SubscriptionStatus.EXPIRED.name();
                default -> status.get().name();
            };
            return free(userId, reported, subscription.getVersion());
        }
        return new Entitlements(
                userId,
                effective,
                PlanCapabilities.grantedBy(effective),
                status.get().name(),
                subscription.getCurrentPeriodEnd(),
                subscription.getVersion());
    }

    private Plan planConsideringPending(Subscription subscription, Plan current, Instant now) {
        Optional<Plan> pending = Plan.parse(subscription.getPendingPlanRaw());
        if (pending.isPresent()
                && subscription.getEffectiveAt() != null
                && !subscription.getEffectiveAt().isAfter(now)) {
            return pending.get();
        }
        return current;
    }

    private boolean withinPeriod(Subscription subscription, Instant now) {
        return subscription.getCurrentPeriodEnd() != null
                && subscription.getCurrentPeriodEnd().isAfter(now);
    }

    /**
     * PAST_DUE keeps the paid plan only while `now < periodEnd + grace`.
     * No period end recorded → no basis for grace → grants nothing
     * (fail closed), same rule as everywhere else in this service.
     */
    private boolean withinPastDueGrace(Subscription subscription, Instant now) {
        return subscription.getCurrentPeriodEnd() != null
                && subscription.getCurrentPeriodEnd().plus(PAST_DUE_GRACE).isAfter(now);
    }

    private Entitlements free(String userId, String status, long version) {
        return new Entitlements(
                userId, Plan.FREE, PlanCapabilities.grantedBy(Plan.FREE), status, null, version);
    }
}
