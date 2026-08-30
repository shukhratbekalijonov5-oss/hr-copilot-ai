package ai.hrcopilot.payment.service;

import ai.hrcopilot.payment.domain.Plan;
import ai.hrcopilot.payment.domain.SubscriptionStatus;
import ai.hrcopilot.payment.domain.entity.BillingAuditLog;
import ai.hrcopilot.payment.domain.entity.CustomerBillingAccount;
import ai.hrcopilot.payment.domain.entity.Payment;
import ai.hrcopilot.payment.domain.entity.ProviderWebhookEvent;
import ai.hrcopilot.payment.domain.entity.Subscription;
import ai.hrcopilot.payment.events.BillingTopics;
import ai.hrcopilot.payment.outbox.OutboxWriter;
import ai.hrcopilot.payment.provider.MockPaymentProvider;
import ai.hrcopilot.payment.provider.ProviderEvent;
import ai.hrcopilot.payment.repository.BillingAuditLogRepository;
import ai.hrcopilot.payment.repository.CustomerBillingAccountRepository;
import ai.hrcopilot.payment.repository.PaymentRepository;
import ai.hrcopilot.payment.repository.ProviderWebhookEventRepository;
import ai.hrcopilot.payment.repository.SubscriptionRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Turns a VERIFIED provider event into billing state — exactly once.
 *
 * ## The idempotency mechanism
 *
 * The webhook event row (unique on provider + providerEventId) is inserted
 * in the SAME transaction as everything it causes. A redelivery hits the
 * unique constraint, the whole transaction rolls back to nothing, and the
 * caller answers "duplicate" from the already-committed first row. One
 * event → one transition → one audit trail → one set of outbox events,
 * enforced by the database.
 */
@Service
public class WebhookProcessingService {

    public enum Outcome {
        PROCESSED,
        DUPLICATE,
        IGNORED
    }

    private final ProviderWebhookEventRepository webhookEvents;
    private final CustomerBillingAccountRepository accounts;
    private final SubscriptionRepository subscriptions;
    private final PaymentRepository payments;
    private final BillingAuditLogRepository audit;
    private final OutboxWriter outbox;
    private final TransactionTemplate transactions;
    private final PaymentConfirmationService confirmation;
    private final Counter processed;
    private final Counter duplicates;
    private final Counter transitions;

    public WebhookProcessingService(
            ProviderWebhookEventRepository webhookEvents,
            CustomerBillingAccountRepository accounts,
            SubscriptionRepository subscriptions,
            PaymentRepository payments,
            BillingAuditLogRepository audit,
            OutboxWriter outbox,
            TransactionTemplate transactions,
            PaymentConfirmationService confirmation,
            MeterRegistry meters) {
        this.webhookEvents = webhookEvents;
        this.accounts = accounts;
        this.subscriptions = subscriptions;
        this.payments = payments;
        this.audit = audit;
        this.outbox = outbox;
        this.transactions = transactions;
        this.confirmation = confirmation;
        this.processed = Counter.builder("payment_webhook_processed_total").register(meters);
        this.duplicates = Counter.builder("payment_webhook_duplicate_total").register(meters);
        this.transitions = meters.counter("subscription_transition_total");
    }

    public Outcome process(String providerName, ProviderEvent event, String rawBody) {
        try {
            /*
             * Programmatic transaction, deliberately: the duplicate catch
             * must sit OUTSIDE the transaction boundary (the conflict aborts
             * the transaction), and a self-invoked @Transactional method
             * would silently run without one — the exact bug that turns
             * "exactly once" into "partially, twice".
             */
            Outcome outcome = transactions.execute(
                    ignored -> processOnce(providerName, event, rawBody));
            processed.increment();
            return outcome;
        } catch (DataIntegrityViolationException alreadySeen) {
            duplicates.increment();
            return Outcome.DUPLICATE;
        }
    }

    private Outcome processOnce(String providerName, ProviderEvent event, String rawBody) {
        // The idempotency anchor. If this insert conflicts, the WHOLE
        // transaction — including any transition below — never happened.
        ProviderWebhookEvent record = webhookEvents.save(
                ProviderWebhookEvent.received(providerName, event.providerEventId(), event.type(), rawBody));

        if (ProviderEvent.PAYMENT_PENDING.equals(event.type())) {
            // A non-final provider status (READY / IN_PROGRESS / ...). It is
            // RECORDED (redelivery stays idempotent) and changes nothing —
            // the final DONE or failure event still has a pending payment
            // to land on.
            record.markProcessed(Outcome.IGNORED.name());
            return Outcome.IGNORED;
        }

        if (event.providerOrderId() != null && !event.providerOrderId().isBlank()) {
            PaymentConfirmationService.Outcome confirmationOutcome = confirmation.applyConfirmedEvent(event);
            record.markProcessed(confirmationOutcome.name());
            return confirmationOutcome == PaymentConfirmationService.Outcome.DUPLICATE
                    ? Outcome.DUPLICATE
                    : Outcome.PROCESSED;
        }

        if (!ProviderEvent.PAYMENT_SUCCEEDED.equals(event.type())) {
            // Unknown/uninteresting event types are RECORDED (so redelivery
            // stays idempotent) and cause no transition.
            record.markProcessed(Outcome.IGNORED.name());
            return Outcome.IGNORED;
        }

        if (!MockPaymentProvider.NAME.equals(providerName)) {
            // Structural rule: a REAL provider's webhook body must never
            // grant a plan. Real activations go through the order-bound
            // path above (authenticated re-fetch → applyConfirmedEvent).
            // Only the sandbox provider, whose signed webhook IS its
            // simulated PSP truth, may take the direct branch below.
            record.markProcessed(Outcome.IGNORED.name());
            return Outcome.IGNORED;
        }

        Plan plan = Plan.parse(event.plan())
                .filter(candidate -> candidate != Plan.FREE)
                .orElseThrow(() -> new IllegalArgumentException("Webhook carried no purchasable plan"));

        CustomerBillingAccount account = accounts.findByUserId(event.userId())
                .orElseGet(() -> accounts.save(CustomerBillingAccount.create(event.userId())));
        Subscription subscription = subscriptions.findByBillingAccountId(account.getId())
                .orElseGet(() -> subscriptions.save(
                        Subscription.create(account.getId(), Plan.FREE, SubscriptionStatus.PENDING)));

        Plan previous = Plan.parse(subscription.getCurrentPlanRaw()).orElse(Plan.FREE);
        Instant now = Instant.now();
        subscription.activate(plan, now, now.plus(30, ChronoUnit.DAYS));
        subscriptions.save(subscription);

        payments.save(Payment.settled(
                account.getId(),
                subscription.getId(),
                providerName,
                event.providerPaymentId(),
                plan.name(),
                event.amountCents(),
                event.currency()));

        audit.save(BillingAuditLog.entry(
                account.getId(),
                event.userId(),
                "SUBSCRIPTION_ACTIVATED",
                "{\"plan\":\"" + plan.name() + "\",\"providerEventId\":\"" + event.providerEventId() + "\"}",
                "webhook:" + providerName));

        String subscriptionId = subscription.getId().toString();
        outbox.append(
                BillingTopics.PAYMENT_EVENTS,
                "payment",
                subscriptionId,
                "PAYMENT_SUCCEEDED",
                event.userId(),
                Map.of("plan", plan.name(), "amountCents", event.amountCents(), "currency", event.currency()));
                /*
                 * The activation FACTS the Notification Service renders into
                 * the "subscription activated" email. Every value here is
                 * authoritative billing state that was just committed — the
                 * period the subscription actually holds and the amount the
                 * provider actually settled. Nothing downstream may invent
                 * these, so they travel with the event or not at all.
                 */
        outbox.append(
                BillingTopics.SUBSCRIPTION_EVENTS,
                "subscription",
                subscriptionId,
                "SUBSCRIPTION_ACTIVATED",
                event.userId(),
                Map.of(
                        "plan", plan.name(),
                        "status", SubscriptionStatus.ACTIVE.name(),
                        "periodStart", subscription.getCurrentPeriodStart().toString(),
                        "periodEnd", subscription.getCurrentPeriodEnd().toString(),
                        "amountMinor", event.amountCents(),
                        "currency", event.currency()));
        outbox.append(
                BillingTopics.ENTITLEMENT_EVENTS,
                "subscription",
                subscriptionId,
                "ENTITLEMENT_CHANGED",
                event.userId(),
                Map.of("plan", plan.name(), "previousPlan", previous.name(), "source", "webhook:" + providerName));

        record.markProcessed(Outcome.PROCESSED.name());
        transitions.increment();
        return Outcome.PROCESSED;
    }
}
