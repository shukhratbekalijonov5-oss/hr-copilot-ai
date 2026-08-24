package ai.hrcopilot.notification.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * The transactional outbox row: an event that IS part of the state change
 * that caused it.
 *
 * Written in the same transaction as the billing transition; published to
 * Kafka afterwards by the outbox worker. If the transaction rolls back the
 * event never existed; if Kafka is down the event waits here with an
 * attempt count. At no point can state be committed with its event lost,
 * or an event published for state that never committed.
 */
@Entity
@Table(name = "outbox_events")
public class OutboxEvent {

    @Id
    private UUID id;

    @Column(name = "aggregate_type", nullable = false, length = 32)
    private String aggregateType;

    @Column(name = "aggregate_id", nullable = false, length = 64)
    private String aggregateId;

    @Column(name = "event_type", nullable = false, length = 64)
    private String eventType;

    @Column(name = "event_version", nullable = false)
    private int eventVersion;

    @Column(name = "topic", nullable = false, length = 128)
    private String topic;

    @Column(name = "payload", nullable = false, columnDefinition = "text")
    private String payload;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "published_at")
    private Instant publishedAt;

    @Column(name = "attempt_count", nullable = false)
    private int attemptCount;

    @Column(name = "last_error", columnDefinition = "text")
    private String lastError;

    @Column(name = "next_attempt_at")
    private Instant nextAttemptAt;

    protected OutboxEvent() {
    }

    public static OutboxEvent pending(
            String aggregateType,
            String aggregateId,
            String eventType,
            int eventVersion,
            String topic,
            String payload) {
        OutboxEvent event = new OutboxEvent();
        event.id = UUID.randomUUID();
        event.aggregateType = aggregateType;
        event.aggregateId = aggregateId;
        event.eventType = eventType;
        event.eventVersion = eventVersion;
        event.topic = topic;
        event.payload = payload;
        event.createdAt = Instant.now();
        return event;
    }

    public UUID getId() {
        return id;
    }

    public String getTopic() {
        return topic;
    }

    public String getAggregateId() {
        return aggregateId;
    }

    public String getEventType() {
        return eventType;
    }

    public int getEventVersion() {
        return eventVersion;
    }

    public String getPayload() {
        return payload;
    }

    public Instant getPublishedAt() {
        return publishedAt;
    }

    public int getAttemptCount() {
        return attemptCount;
    }

    public Instant getNextAttemptAt() {
        return nextAttemptAt;
    }

    public void markPublished() {
        this.publishedAt = Instant.now();
    }

    /**
     * A failed publish: count the attempt, keep a BOUNDED error summary,
     * and step aside with exponential backoff (5s doubling, capped at 5
     * minutes) so an outage or poison row is not retried on every tick.
     * Deliberately NO terminal/dead state — a billing event is never
     * discarded; a stuck row stays pending and visible in the outbox
     * metrics until the broker recovers or an operator intervenes.
     */
    public void markFailed(String error) {
        this.attemptCount += 1;
        String summary = (error == null || error.isBlank()) ? "unknown" : error;
        this.lastError = summary.length() > 500 ? summary.substring(0, 500) : summary;
        long delaySeconds = Math.min(300L, 5L * (1L << Math.min(this.attemptCount - 1, 6)));
        this.nextAttemptAt = Instant.now().plusSeconds(delaySeconds);
    }
}
