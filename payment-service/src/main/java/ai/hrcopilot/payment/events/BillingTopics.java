package ai.hrcopilot.payment.events;

/** The three billing topics. Versioned in the NAME, never silently mutated. */
public final class BillingTopics {
    public static final String PAYMENT_EVENTS = "billing.payment-events.v1";
    public static final String SUBSCRIPTION_EVENTS = "billing.subscription-events.v1";
    public static final String ENTITLEMENT_EVENTS = "billing.entitlement-events.v1";

    private BillingTopics() {
    }
}
