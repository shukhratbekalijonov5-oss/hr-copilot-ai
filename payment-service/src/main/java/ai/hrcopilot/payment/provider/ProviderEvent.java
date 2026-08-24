package ai.hrcopilot.payment.provider;

/**
 * A provider webhook, normalized. `providerEventId` is the provider's OWN
 * delivery/event identity — the value the idempotency constraint holds.
 */
public record ProviderEvent(
        String providerEventId,
        String type,
        String userId,
        String providerOrderId,
        String plan,
        String providerPaymentId,
        int amountCents,
        String currency) {

    public static final String PAYMENT_SUCCEEDED = "PAYMENT_SUCCEEDED";
    public static final String PAYMENT_FAILED = "PAYMENT_FAILED";
    /**
     * The provider reports a NON-FINAL status (Toss READY / IN_PROGRESS /
     * WAITING_FOR_DEPOSIT). Not a success, not a failure: processing must
     * change nothing, so a later final event can still land.
     */
    public static final String PAYMENT_PENDING = "PAYMENT_PENDING";
}
