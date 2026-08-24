package ai.hrcopilot.notification.events;

/** The topics this service touches. Versioned in the NAME, never mutated. */
public final class NotificationTopics {
    /** Inbound: the backend's notification outbox (business + account events). */
    public static final String NOTIFICATION_EVENTS = "notifications.events.v1";
    /** Inbound: the Payment Service's subscription lifecycle facts. */
    public static final String BILLING_SUBSCRIPTION_EVENTS = "billing.subscription-events.v1";
    /** Outbound: the created-echo the backend bridges onto its websocket. */
    public static final String NOTIFICATION_CREATED = "notifications.created.v1";

    private NotificationTopics() {
    }
}
