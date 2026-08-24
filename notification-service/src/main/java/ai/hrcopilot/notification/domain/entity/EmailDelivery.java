package ai.hrcopilot.notification.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * One email the product owes a user — state, attempts, and NO address.
 *
 * The recipient is a USER ID on purpose: the current email address is
 * resolved from the backend at every send attempt, so a user who changes
 * their address between failure and retry gets the retry at the NEW
 * address. Persisting an address here would silently freeze delivery
 * authority at enqueue time.
 *
 * `(event_id, email_type)` is UNIQUE: one logical event = one email.
 */
@Entity
@Table(name = "email_deliveries")
public class EmailDelivery {

    /** Bounded backoff ladder; after the last rung the failure is permanent. */
    private static final List<Duration> BACKOFF = List.of(
            Duration.ofSeconds(30),
            Duration.ofMinutes(2),
            Duration.ofMinutes(10),
            Duration.ofMinutes(30),
            Duration.ofHours(2));

    public enum Status {
        PENDING,
        PROCESSING,
        SENT,
        FAILED_RETRYABLE,
        FAILED_PERMANENT
    }

    @Id
    private UUID id;

    @Column(name = "notification_id")
    private UUID notificationId;

    @Column(name = "event_id", nullable = false, length = 200)
    private String eventId;

    @Column(name = "email_type", nullable = false, length = 64)
    private String emailType;

    @Column(name = "recipient_user_id", nullable = false, length = 64)
    private String recipientUserId;

    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "attempt_count", nullable = false)
    private int attemptCount;

    @Column(name = "next_attempt_at")
    private Instant nextAttemptAt;

    @Column(name = "last_error", columnDefinition = "text")
    private String lastError;

    @Column(name = "sent_at")
    private Instant sentAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected EmailDelivery() {
    }

    public static EmailDelivery pending(
            UUID notificationId, String eventId, String emailType, String recipientUserId) {
        EmailDelivery delivery = new EmailDelivery();
        delivery.id = UUID.randomUUID();
        delivery.notificationId = notificationId;
        delivery.eventId = eventId;
        delivery.emailType = emailType;
        delivery.recipientUserId = recipientUserId;
        delivery.status = Status.PENDING.name();
        delivery.createdAt = Instant.now();
        delivery.updatedAt = delivery.createdAt;
        return delivery;
    }

    public UUID getId() {
        return id;
    }

    public UUID getNotificationId() {
        return notificationId;
    }

    public String getEventId() {
        return eventId;
    }

    public String getEmailType() {
        return emailType;
    }

    public String getRecipientUserId() {
        return recipientUserId;
    }

    public String getStatus() {
        return status;
    }

    public int getAttemptCount() {
        return attemptCount;
    }

    public Instant getNextAttemptAt() {
        return nextAttemptAt;
    }

    public String getLastError() {
        return lastError;
    }

    public Instant getSentAt() {
        return sentAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void markSent() {
        this.status = Status.SENT.name();
        this.sentAt = Instant.now();
        this.updatedAt = this.sentAt;
        this.lastError = null;
        this.nextAttemptAt = null;
    }

    /**
     * A retryable failure: count it, keep a BOUNDED sanitized summary, and
     * either step back onto the backoff ladder or — past its last rung —
     * become permanent. Nothing is silently discarded; a permanent failure
     * stays visible in metrics and in this row.
     */
    public void markFailed(String error) {
        this.attemptCount += 1;
        String summary = (error == null || error.isBlank()) ? "unknown" : error;
        this.lastError = summary.length() > 500 ? summary.substring(0, 500) : summary;
        this.updatedAt = Instant.now();
        if (this.attemptCount > BACKOFF.size()) {
            this.status = Status.FAILED_PERMANENT.name();
            this.nextAttemptAt = null;
            return;
        }
        this.status = Status.FAILED_RETRYABLE.name();
        this.nextAttemptAt = Instant.now().plus(BACKOFF.get(this.attemptCount - 1));
    }

    /** A failure no retry can fix (recipient gone, address invalid). */
    public void markPermanentlyFailed(String error) {
        this.attemptCount += 1;
        String summary = (error == null || error.isBlank()) ? "unknown" : error;
        this.lastError = summary.length() > 500 ? summary.substring(0, 500) : summary;
        this.status = Status.FAILED_PERMANENT.name();
        this.nextAttemptAt = null;
        this.updatedAt = Instant.now();
    }
}
