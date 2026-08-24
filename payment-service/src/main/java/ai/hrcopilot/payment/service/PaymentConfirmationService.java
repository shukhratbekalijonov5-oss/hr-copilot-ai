package ai.hrcopilot.payment.service;

import ai.hrcopilot.payment.domain.Plan;
import ai.hrcopilot.payment.domain.SubscriptionStatus;
import ai.hrcopilot.payment.domain.entity.BillingAuditLog;
import ai.hrcopilot.payment.domain.entity.CustomerBillingAccount;
import ai.hrcopilot.payment.domain.entity.Payment;
import ai.hrcopilot.payment.domain.entity.Subscription;
import ai.hrcopilot.payment.events.BillingTopics;
import ai.hrcopilot.payment.outbox.OutboxWriter;
import ai.hrcopilot.payment.provider.PaymentProvider;
import ai.hrcopilot.payment.provider.ProviderEvent;
import ai.hrcopilot.payment.repository.BillingAuditLogRepository;
import ai.hrcopilot.payment.repository.CustomerBillingAccountRepository;
import ai.hrcopilot.payment.repository.PaymentRepository;
import ai.hrcopilot.payment.repository.SubscriptionRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Confirms an authenticated provider payment after redirect. Browser query
 * values are treated as hints only: order and amount are checked against the
 * pending payment row before the provider confirm call can happen.
 */
@Service
public class PaymentConfirmationService {

    public enum Outcome {
        PROCESSED,
        DUPLICATE
    }

    private final PaymentProvider provider;
    private final PaymentRepository payments;
    private final CustomerBillingAccountRepository accounts;
    private final SubscriptionRepository subscriptions;
    private final BillingAuditLogRepository audit;
    private final OutboxWriter outbox;
    private final TransactionTemplate transactions;

    public PaymentConfirmationService(
            PaymentProvider provider,
            PaymentRepository payments,
            CustomerBillingAccountRepository accounts,
            SubscriptionRepository subscriptions,
            BillingAuditLogRepository audit,
            OutboxWriter outbox,
            TransactionTemplate transactions) {
        this.provider = provider;
        this.payments = payments;
        this.accounts = accounts;
        this.subscriptions = subscriptions;
        this.audit = audit;
        this.outbox = outbox;
        this.transactions = transactions;
    }

    public Outcome confirm(String paymentKey, String orderId, String amount) {
        if (paymentKey == null || paymentKey.isBlank()) {
            throw new IllegalArgumentException("paymentKey is required");
        }
        Payment current = payments.findByProviderAndProviderCheckoutId(provider.name(), orderId)
                .orElseThrow(() -> new IllegalArgumentException("unknown orderId"));
        int amountCents = parseAmountMinor(amount, current.getCurrency());
        if (current.getAmountCents() != amountCents) {
            throw new IllegalArgumentException("payment amount mismatch");
        }
        if (current.isSucceeded()) {
            if (paymentKey.equals(current.getProviderPaymentId())) {
                return Outcome.DUPLICATE;
            }
            throw new IllegalArgumentException("order already confirmed with a different paymentKey");
        }
        if (!current.isPending()) {
            throw new IllegalStateException("payment is not confirmable");
        }

        ProviderEvent event = provider.confirmPayment(new PaymentProvider.ConfirmationRequest(
                orderId, paymentKey, current.getAmountCents(), current.getCurrency()));
        return transactions.execute(ignored -> applyConfirmedEvent(event));
    }

    public Outcome applyConfirmedEvent(ProviderEvent event) {
        Payment payment = payments.lockByProviderAndProviderCheckoutId(provider.name(), event.providerOrderId())
                .orElseThrow(() -> new IllegalArgumentException("unknown orderId"));
        if (payment.isSucceeded()) {
            if (event.providerPaymentId().equals(payment.getProviderPaymentId())) {
                return Outcome.DUPLICATE;
            }
            throw new IllegalArgumentException("order already confirmed with a different paymentKey");
        }
        if (!payment.isPending()) {
            throw new IllegalStateException("payment is not confirmable");
        }
        if (ProviderEvent.PAYMENT_PENDING.equals(event.type())) {
            // The provider answered a NON-FINAL status. The payment stays
            // PENDING and confirmable; marking it failed here would
            // permanently kill a purchase the customer is completing.
            throw new IllegalStateException("payment is not final at the provider yet");
        }
        if (!ProviderEvent.PAYMENT_SUCCEEDED.equals(event.type())) {
            payment.markFailed(event.providerPaymentId());
            payments.save(payment);
            return Outcome.PROCESSED;
        }
        if (payment.getAmountCents() != event.amountCents() || !payment.getCurrency().equals(event.currency())) {
            throw new IllegalArgumentException("confirmed payment amount mismatch");
        }

        CustomerBillingAccount account = accounts.findById(payment.getBillingAccountId())
                .orElseThrow(() -> new IllegalStateException("billing account missing"));
        Subscription subscription = subscriptions.findByBillingAccountId(account.getId())
                .orElseGet(() -> subscriptions.save(
                        Subscription.create(account.getId(), Plan.FREE, SubscriptionStatus.PENDING)));

        Plan plan = Plan.parse(payment.getPlan())
                .filter(candidate -> candidate != Plan.FREE)
                .orElseThrow(() -> new IllegalStateException("payment carried no purchasable plan"));
        Plan previous = Plan.parse(subscription.getCurrentPlanRaw()).orElse(Plan.FREE);
        Instant now = Instant.now();
        subscription.activate(plan, now, now.plus(30, ChronoUnit.DAYS));
        subscriptions.save(subscription);

        payment.markSucceeded(subscription.getId(), event.providerPaymentId());
        payments.save(payment);

        audit.save(BillingAuditLog.entry(
                account.getId(),
                account.getUserId(),
                "SUBSCRIPTION_ACTIVATED",
                "{\"plan\":\"" + plan.name() + "\",\"providerOrderId\":\"" + event.providerOrderId() + "\"}",
                "confirm:" + provider.name()));

        String subscriptionId = subscription.getId().toString();
        outbox.append(
                BillingTopics.PAYMENT_EVENTS,
                "payment",
                payment.getId().toString(),
                "PAYMENT_SUCCEEDED",
                account.getUserId(),
                Map.of("plan", plan.name(), "amountCents", payment.getAmountCents(), "currency", payment.getCurrency()));
        outbox.append(
                BillingTopics.SUBSCRIPTION_EVENTS,
                "subscription",
                subscriptionId,
                "SUBSCRIPTION_ACTIVATED",
                account.getUserId(),
                Map.of("plan", plan.name(), "status", SubscriptionStatus.ACTIVE.name()));
        outbox.append(
                BillingTopics.ENTITLEMENT_EVENTS,
                "subscription",
                subscriptionId,
                "ENTITLEMENT_CHANGED",
                account.getUserId(),
                Map.of("plan", plan.name(), "previousPlan", previous.name(), "source", "confirm:" + provider.name()));

        return Outcome.PROCESSED;
    }

    /** KRW has no minor unit: "9900" means 9900 won, not 99.00. */
    private int parseAmountMinor(String amount, String currency) {
        try {
            BigDecimal parsed = new BigDecimal(amount);
            return "KRW".equals(currency)
                    ? parsed.intValueExact()
                    : parsed.movePointRight(2).intValueExact();
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("invalid amount");
        }
    }
}
