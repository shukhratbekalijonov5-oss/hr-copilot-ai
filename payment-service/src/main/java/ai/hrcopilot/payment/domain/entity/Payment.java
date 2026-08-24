package ai.hrcopilot.payment.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

/**
 * One payment attempt/settlement.
 *
 * `(billing_account_id, idempotency_key)` is UNIQUE: the same caller
 * retrying the same checkout gets the same row back — the database, not
 * politeness, is what prevents a duplicate order.
 */
@Entity
@Table(name = "payments")
public class Payment {

    @Id
    private UUID id;

    @Column(name = "billing_account_id", nullable = false)
    private UUID billingAccountId;

    @Column(name = "subscription_id")
    private UUID subscriptionId;

    @Column(name = "provider", nullable = false, length = 32)
    private String provider;

    @Column(name = "provider_payment_id", length = 128)
    private String providerPaymentId;

    @Column(name = "provider_checkout_id", length = 128)
    private String providerCheckoutId;

    @Column(name = "checkout_url", length = 512)
    private String checkoutUrl;

    @Column(name = "idempotency_key", length = 128)
    private String idempotencyKey;

    @Column(name = "plan", nullable = false, length = 16)
    private String plan;

    @Column(name = "amount_cents", nullable = false)
    private int amountCents;

    @Column(name = "currency", nullable = false, length = 8)
    private String currency;

    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Payment() {
    }

    public static Payment pendingCheckout(
            UUID id,
            UUID billingAccountId,
            String provider,
            String plan,
            int amountCents,
            String currency,
            String idempotencyKey,
            String providerCheckoutId,
            String checkoutUrl) {
        Payment payment = new Payment();
        payment.id = id;
        payment.billingAccountId = billingAccountId;
        payment.provider = provider;
        payment.plan = plan;
        payment.amountCents = amountCents;
        payment.currency = currency;
        payment.idempotencyKey = idempotencyKey;
        payment.providerCheckoutId = providerCheckoutId;
        payment.checkoutUrl = checkoutUrl;
        payment.status = PaymentStatus.PENDING.name();
        payment.createdAt = Instant.now();
        payment.updatedAt = payment.createdAt;
        return payment;
    }

    public static Payment settled(
            UUID billingAccountId,
            UUID subscriptionId,
            String provider,
            String providerPaymentId,
            String plan,
            int amountCents,
            String currency) {
        Payment payment = new Payment();
        payment.id = UUID.randomUUID();
        payment.billingAccountId = billingAccountId;
        payment.subscriptionId = subscriptionId;
        payment.provider = provider;
        payment.providerPaymentId = providerPaymentId;
        payment.plan = plan;
        payment.amountCents = amountCents;
        payment.currency = currency;
        payment.status = PaymentStatus.SUCCEEDED.name();
        payment.createdAt = Instant.now();
        payment.updatedAt = payment.createdAt;
        return payment;
    }

    public UUID getId() {
        return id;
    }

    public UUID getBillingAccountId() {
        return billingAccountId;
    }

    public UUID getSubscriptionId() {
        return subscriptionId;
    }

    public String getProvider() {
        return provider;
    }

    public String getProviderPaymentId() {
        return providerPaymentId;
    }

    public String getStatus() {
        return status;
    }

    public String getPlan() {
        return plan;
    }

    public int getAmountCents() {
        return amountCents;
    }

    public String getProviderCheckoutId() {
        return providerCheckoutId;
    }

    public String getCheckoutUrl() {
        return checkoutUrl;
    }

    public String getIdempotencyKey() {
        return idempotencyKey;
    }

    public String getCurrency() {
        return currency;
    }

    public boolean isPending() {
        return PaymentStatus.PENDING.name().equals(status);
    }

    public boolean isSucceeded() {
        return PaymentStatus.SUCCEEDED.name().equals(status);
    }

    public void markSucceeded(UUID subscriptionId, String providerPaymentId) {
        this.subscriptionId = subscriptionId;
        this.providerPaymentId = providerPaymentId;
        this.status = PaymentStatus.SUCCEEDED.name();
        this.updatedAt = Instant.now();
    }

    public void markFailed(String providerPaymentId) {
        this.providerPaymentId = providerPaymentId;
        this.status = PaymentStatus.FAILED.name();
        this.updatedAt = Instant.now();
    }
}
