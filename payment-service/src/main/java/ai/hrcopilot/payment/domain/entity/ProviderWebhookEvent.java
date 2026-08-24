package ai.hrcopilot.payment.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * Every provider event, exactly once.
 *
 * `(provider, provider_event_id)` is UNIQUE, and the row is inserted in the
 * SAME transaction as the state transition it causes. A redelivered webhook
 * therefore hits the constraint, the transaction never happens, and the
 * subscription cannot be double-activated — idempotency is a database fact,
 * not an application promise.
 */
@Entity
@Table(name = "provider_webhook_events")
public class ProviderWebhookEvent {

    @Id
    private UUID id;

    @Column(name = "provider", nullable = false, length = 32)
    private String provider;

    @Column(name = "provider_event_id", nullable = false, length = 160)
    private String providerEventId;

    @Column(name = "event_type", nullable = false, length = 64)
    private String eventType;

    @Column(name = "payload", nullable = false, columnDefinition = "text")
    private String payload;

    @Column(name = "received_at", nullable = false)
    private Instant receivedAt;

    @Column(name = "processed_at")
    private Instant processedAt;

    @Column(name = "processing_result", length = 32)
    private String processingResult;

    protected ProviderWebhookEvent() {
    }

    public static ProviderWebhookEvent received(
            String provider, String providerEventId, String eventType, String payload) {
        ProviderWebhookEvent event = new ProviderWebhookEvent();
        event.id = UUID.randomUUID();
        event.provider = provider;
        event.providerEventId = providerEventId;
        event.eventType = eventType;
        event.payload = payload;
        event.receivedAt = Instant.now();
        return event;
    }

    public void markProcessed(String result) {
        this.processedAt = Instant.now();
        this.processingResult = result;
    }

    public UUID getId() {
        return id;
    }

    public String getProcessingResult() {
        return processingResult;
    }
}
