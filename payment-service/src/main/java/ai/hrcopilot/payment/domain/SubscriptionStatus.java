package ai.hrcopilot.payment.domain;

import java.util.Optional;

/**
 * Subscription lifecycle. Stored as strings; re-entered through
 * {@link #parse} so corrupt/unknown state fails closed instead of throwing.
 *
 * Which statuses retain a paid plan is decided in ONE place —
 * EntitlementService — not here.
 */
public enum SubscriptionStatus {
    PENDING,
    ACTIVE,
    PAST_DUE,
    CANCEL_AT_PERIOD_END,
    CANCELLED,
    EXPIRED;

    public static Optional<SubscriptionStatus> parse(String raw) {
        if (raw == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(SubscriptionStatus.valueOf(raw));
        } catch (IllegalArgumentException unknown) {
            return Optional.empty();
        }
    }
}
