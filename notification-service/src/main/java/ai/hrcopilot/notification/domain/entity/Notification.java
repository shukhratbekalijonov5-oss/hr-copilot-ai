package ai.hrcopilot.notification.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * One user-facing notification — the AUTHORITATIVE row.
 *
 * `event_id` is UNIQUE and inserted in the same transaction as everything
 * the event causes (email delivery row, created-echo outbox event): a
 * redelivered Kafka message or a re-run scheduler hits the constraint, the
 * transaction rolls back to nothing, and idempotency is a database fact.
 */
@Entity
@Table(name = "notifications")
public class Notification {

    @Id
    private UUID id;

    @Column(name = "event_id", nullable = false, length = 200)
    private String eventId;

    @Column(name = "recipient_user_id", nullable = false, length = 64)
    private String recipientUserId;

    @Column(name = "organization_id", length = 64)
    private String organizationId;

    @Column(name = "audience", nullable = false, length = 16)
    private String audience;

    @Column(name = "type", nullable = false, length = 64)
    private String type;

    @Column(name = "context_json", nullable = false, columnDefinition = "text")
    private String contextJson;

    @Column(name = "read_at")
    private Instant readAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Notification() {
    }

    public static Notification of(
            String eventId,
            String recipientUserId,
            String organizationId,
            String audience,
            String type,
            String contextJson) {
        Notification notification = new Notification();
        notification.id = UUID.randomUUID();
        notification.eventId = eventId;
        notification.recipientUserId = recipientUserId;
        notification.organizationId = organizationId;
        notification.audience = audience;
        notification.type = type;
        notification.contextJson = contextJson;
        notification.createdAt = Instant.now();
        notification.updatedAt = notification.createdAt;
        return notification;
    }

    /** Legacy import: preserves original creation time and read state. */
    public static Notification imported(
            String eventId,
            String recipientUserId,
            String organizationId,
            String audience,
            String type,
            String contextJson,
            Instant createdAt,
            Instant readAt) {
        Notification notification = of(
                eventId, recipientUserId, organizationId, audience, type, contextJson);
        notification.createdAt = createdAt;
        notification.updatedAt = createdAt;
        notification.readAt = readAt;
        return notification;
    }

    public UUID getId() {
        return id;
    }

    public String getEventId() {
        return eventId;
    }

    public String getRecipientUserId() {
        return recipientUserId;
    }

    public String getOrganizationId() {
        return organizationId;
    }

    public String getAudience() {
        return audience;
    }

    public String getType() {
        return type;
    }

    public String getContextJson() {
        return contextJson;
    }

    public Instant getReadAt() {
        return readAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public boolean isRead() {
        return readAt != null;
    }

    public void markRead() {
        if (this.readAt == null) {
            this.readAt = Instant.now();
            this.updatedAt = this.readAt;
        }
    }
}
