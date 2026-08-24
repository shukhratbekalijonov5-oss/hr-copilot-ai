package ai.hrcopilot.payment.service;

import ai.hrcopilot.payment.domain.Plan;
import ai.hrcopilot.payment.domain.entity.CustomerBillingAccount;
import ai.hrcopilot.payment.domain.entity.Payment;
import ai.hrcopilot.payment.events.BillingTopics;
import ai.hrcopilot.payment.outbox.OutboxWriter;
import ai.hrcopilot.payment.provider.PaymentProvider;
import ai.hrcopilot.payment.repository.CustomerBillingAccountRepository;
import ai.hrcopilot.payment.repository.PaymentRepository;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Checkout creation, idempotent by construction.
 *
 * `(billing account, Idempotency-Key)` is a UNIQUE constraint on payments:
 * the same user retrying the same key gets the SAME payment and the same
 * provider checkout back — including under a concurrent race, where the
 * loser's insert violates the constraint and the winner's row is re-read
 * and returned. No duplicate order can exist to charge twice.
 */
@Service
public class CheckoutService {

    public record CheckoutResult(String paymentId, String checkoutId, String redirectUrl, boolean reused) {
    }

    private final CustomerBillingAccountRepository accounts;
    private final PaymentRepository payments;
    private final PaymentProvider provider;
    private final OutboxWriter outbox;
    private final TransactionTemplate transactions;

    public CheckoutService(
            CustomerBillingAccountRepository accounts,
            PaymentRepository payments,
            PaymentProvider provider,
            OutboxWriter outbox,
            TransactionTemplate transactions) {
        this.accounts = accounts;
        this.payments = payments;
        this.provider = provider;
        this.outbox = outbox;
        this.transactions = transactions;
    }

    public CheckoutResult createCheckout(String userId, Plan plan, String idempotencyKey) {
        if (plan == Plan.FREE) {
            throw new IllegalArgumentException("FREE has nothing to purchase");
        }
        try {
            // Programmatic transaction for the same reason as the webhook
            // path: the race catch must live outside the boundary.
            return transactions.execute(ignored -> createOnce(userId, plan, idempotencyKey));
        } catch (DataIntegrityViolationException raced) {
            // A concurrent request with the same key won. Serve their row.
            return existing(userId, idempotencyKey)
                    .orElseThrow(() -> raced);
        }
    }

    private CheckoutResult createOnce(String userId, Plan plan, String idempotencyKey) {
        CustomerBillingAccount account = accounts.findByUserId(userId)
                .orElseGet(() -> accounts.save(CustomerBillingAccount.create(userId)));

        Optional<Payment> reused = payments
                .findByBillingAccountIdAndIdempotencyKey(account.getId(), idempotencyKey);
        if (reused.isPresent()) {
            Payment payment = reused.get();
            return new CheckoutResult(
                    payment.getId().toString(),
                    payment.getProviderCheckoutId(),
                    payment.getCheckoutUrl(),
                    true);
        }

        UUID paymentId = UUID.randomUUID();
        String providerOrderId = orderIdFor(paymentId);
        // The provider owns the charge amount AND currency (fixed,
        // server-side). The browser never supplies either.
        PaymentProvider.Price price = provider.checkoutPrice(plan);
        PaymentProvider.CheckoutSession session =
                provider.createCheckout(new PaymentProvider.CheckoutRequest(
                        userId,
                        plan,
                        price.amountMinor(),
                        price.currency(),
                        providerOrderId,
                        "HR Copilot " + plan.name() + " monthly plan",
                        idempotencyKey));
        Payment payment = payments.save(Payment.pendingCheckout(
                paymentId,
                account.getId(),
                provider.name(),
                plan.name(),
                price.amountMinor(),
                price.currency(),
                idempotencyKey,
                session.checkoutId(),
                session.redirectUrl()));

        outbox.append(
                BillingTopics.PAYMENT_EVENTS,
                "payment",
                payment.getId().toString(),
                "PAYMENT_CHECKOUT_CREATED",
                userId,
                Map.of("plan", plan.name(), "amountCents", price.amountMinor(), "currency", price.currency()));

        return new CheckoutResult(
                payment.getId().toString(), session.checkoutId(), session.redirectUrl(), false);
    }

    private String orderIdFor(UUID paymentId) {
        // Toss orderId: 6-64 chars, letters/digits/-/_ only. No PII.
        return "hrc_" + paymentId.toString().replace("-", "");
    }

    private Optional<CheckoutResult> existing(String userId, String idempotencyKey) {
        return accounts.findByUserId(userId)
                .flatMap(account ->
                        payments.findByBillingAccountIdAndIdempotencyKey(account.getId(), idempotencyKey))
                .map(payment -> new CheckoutResult(
                        payment.getId().toString(),
                        payment.getProviderCheckoutId(),
                        payment.getCheckoutUrl(),
                        true));
    }
}
