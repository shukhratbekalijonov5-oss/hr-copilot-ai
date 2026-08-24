package ai.hrcopilot.payment.service;

import ai.hrcopilot.payment.domain.Plan;
import ai.hrcopilot.payment.domain.entity.BillingAuditLog;
import ai.hrcopilot.payment.domain.entity.CustomerBillingAccount;
import ai.hrcopilot.payment.domain.entity.Subscription;
import ai.hrcopilot.payment.domain.SubscriptionStatus;
import ai.hrcopilot.payment.events.BillingTopics;
import ai.hrcopilot.payment.outbox.OutboxWriter;
import ai.hrcopilot.payment.repository.BillingAuditLogRepository;
import ai.hrcopilot.payment.repository.CustomerBillingAccountRepository;
import ai.hrcopilot.payment.repository.SubscriptionRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Direct plan transitions — the DEV/TEST switch's engine, and the shared
 * subscription mutation used by webhook activation.
 *
 * Every mutation here follows the one non-negotiable shape: state change +
 * audit row + outbox event(s) in ONE transaction. Nothing commits state
 * whose event could then be lost.
 */
@Service
public class PlanSwitchService {

    public record SwitchResult(Plan plan, boolean changed) {
    }

    private final CustomerBillingAccountRepository accounts;
    private final SubscriptionRepository subscriptions;
    private final BillingAuditLogRepository audit;
    private final OutboxWriter outbox;
    private final Counter transitions;

    public PlanSwitchService(
            CustomerBillingAccountRepository accounts,
            SubscriptionRepository subscriptions,
            BillingAuditLogRepository audit,
            OutboxWriter outbox,
            MeterRegistry meters) {
        this.accounts = accounts;
        this.subscriptions = subscriptions;
        this.audit = audit;
        this.outbox = outbox;
        this.transitions = Counter.builder("subscription_transition_total")
                .description("Subscription state transitions, any cause")
                .register(meters);
    }

    /**
     * Switch a user's plan directly. No payment row is written — this is the
     * development path and the plan is the entire point; a real purchase
     * goes through checkout + webhook and writes its payment there.
     *
     * Idempotent: switching to the plan already held changes nothing, writes
     * nothing, and emits nothing — a repeated call cannot double-log or
     * double-publish.
     */
    @Transactional
    public SwitchResult switchPlan(String userId, Plan target, String actor) {
        CustomerBillingAccount account = accounts.findByUserId(userId)
                .orElseGet(() -> accounts.save(CustomerBillingAccount.create(userId)));
        Subscription subscription = subscriptions.findByBillingAccountId(account.getId())
                .orElseGet(() -> subscriptions.save(
                        Subscription.create(account.getId(), Plan.FREE, SubscriptionStatus.ACTIVE)));

        Plan previous = Plan.parse(subscription.getCurrentPlanRaw()).orElse(Plan.FREE);
        boolean alreadyThere = previous == target
                && subscription.getPendingPlanRaw() == null
                && SubscriptionStatus.ACTIVE.name().equals(subscription.getStatusRaw());
        if (alreadyThere) {
            return new SwitchResult(target, false);
        }

        Instant now = Instant.now();
        subscription.activate(target, now, now.plus(30, ChronoUnit.DAYS));
        subscriptions.save(subscription);

        audit.save(BillingAuditLog.entry(
                account.getId(),
                userId,
                "PLAN_SWITCH",
                "{\"from\":\"" + previous.name() + "\",\"to\":\"" + target.name() + "\"}",
                actor));

        outbox.append(
                BillingTopics.ENTITLEMENT_EVENTS,
                "subscription",
                subscription.getId().toString(),
                "ENTITLEMENT_CHANGED",
                userId,
                Map.of("plan", target.name(), "previousPlan", previous.name(), "source", actor));

        transitions.increment();
        return new SwitchResult(target, true);
    }
}
