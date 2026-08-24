package ai.hrcopilot.payment.service;

import ai.hrcopilot.payment.domain.Plan;
import ai.hrcopilot.payment.domain.SubscriptionStatus;
import ai.hrcopilot.payment.domain.entity.BillingAuditLog;
import ai.hrcopilot.payment.domain.entity.Subscription;
import ai.hrcopilot.payment.events.BillingTopics;
import ai.hrcopilot.payment.outbox.OutboxWriter;
import ai.hrcopilot.payment.repository.BillingAuditLogRepository;
import ai.hrcopilot.payment.repository.CustomerBillingAccountRepository;
import ai.hrcopilot.payment.repository.SubscriptionRepository;
import java.time.Instant;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Voluntary subscription changes that are NOT immediate plan switches:
 * scheduled downgrades and end-of-period cancellation.
 *
 * ## The direction rule
 *
 * An UPGRADE takes effect immediately (the user paid for more; making them
 * wait helps nobody) — that is `PlanSwitchService`/webhook territory. A
 * DOWNGRADE and a cancellation are scheduled to the period boundary: the
 * user already paid for the current period, so the higher plan runs until
 * `currentPeriodEnd` and the change lands there. Cancellation never forces
 * FREE early, and never deletes anything.
 */
@Service
public class SubscriptionService {

    private final CustomerBillingAccountRepository accounts;
    private final SubscriptionRepository subscriptions;
    private final BillingAuditLogRepository audit;
    private final OutboxWriter outbox;

    public SubscriptionService(
            CustomerBillingAccountRepository accounts,
            SubscriptionRepository subscriptions,
            BillingAuditLogRepository audit,
            OutboxWriter outbox) {
        this.accounts = accounts;
        this.subscriptions = subscriptions;
        this.audit = audit;
        this.outbox = outbox;
    }

    /**
     * Schedule a downgrade at the current period boundary.
     *
     * Validated, not trusted: only an ACTIVE paid subscription may
     * schedule one, the target must be a strictly LOWER paid tier, and
     * FREE is refused (leaving a paid plan entirely is {@link
     * #cancelAtPeriodEnd}, not a "downgrade" — one contract per intent).
     * Without the direction check this endpoint would be an upgrade that
     * skips payment.
     */
    @Transactional
    public void scheduleDowngrade(String userId, Plan target) {
        Subscription subscription = requireSubscription(userId);
        Plan current = Plan.parse(subscription.getCurrentPlanRaw()).orElse(Plan.FREE);
        if (!SubscriptionStatus.ACTIVE.name().equals(subscription.getStatusRaw())) {
            throw new IllegalStateException("Only an active subscription can schedule a downgrade");
        }
        if (target == Plan.FREE) {
            throw new IllegalArgumentException("Leaving a paid plan is cancellation, not a downgrade");
        }
        if (target.monthlyPriceCents() >= current.monthlyPriceCents()) {
            throw new IllegalArgumentException("A downgrade must target a lower plan");
        }
        Instant effectiveAt = subscription.getCurrentPeriodEnd() != null
                ? subscription.getCurrentPeriodEnd()
                : Instant.now();
        subscription.schedulePlanChange(target, effectiveAt);
        subscriptions.save(subscription);

        audit.save(BillingAuditLog.entry(
                subscription.getBillingAccountId(),
                userId,
                "DOWNGRADE_SCHEDULED",
                "{\"to\":\"" + target.name() + "\",\"effectiveAt\":\"" + effectiveAt + "\"}",
                "subscription-api"));
        outbox.append(
                BillingTopics.SUBSCRIPTION_EVENTS,
                "subscription",
                subscription.getId().toString(),
                "SUBSCRIPTION_DOWNGRADE_SCHEDULED",
                userId,
                Map.of("pendingPlan", target.name(), "effectiveAt", effectiveAt.toString()));
    }

    /** Cancel at period end. The paid plan runs out its period; FREE after. */
    @Transactional
    public void cancelAtPeriodEnd(String userId) {
        Subscription subscription = requireSubscription(userId);
        if (subscription.isCancelAtPeriodEnd()) {
            return; // Idempotent: cancelling a cancelled subscription is a no-op.
        }
        Plan current = Plan.parse(subscription.getCurrentPlanRaw()).orElse(Plan.FREE);
        if (current == Plan.FREE
                || !SubscriptionStatus.ACTIVE.name().equals(subscription.getStatusRaw())) {
            throw new IllegalStateException("No active paid subscription to cancel");
        }
        subscription.scheduleCancellation();
        subscriptions.save(subscription);

        audit.save(BillingAuditLog.entry(
                subscription.getBillingAccountId(),
                userId,
                "CANCEL_AT_PERIOD_END",
                "{\"periodEnd\":\"" + subscription.getCurrentPeriodEnd() + "\"}",
                "subscription-api"));
        outbox.append(
                BillingTopics.SUBSCRIPTION_EVENTS,
                "subscription",
                subscription.getId().toString(),
                "SUBSCRIPTION_CANCEL_SCHEDULED",
                userId,
                Map.of("cancelAtPeriodEnd", "true"));
    }

    private Subscription requireSubscription(String userId) {
        return accounts.findByUserId(userId)
                .flatMap(account -> subscriptions.findByBillingAccountId(account.getId()))
                .orElseThrow(() -> new IllegalStateException("No subscription for user"));
    }
}
