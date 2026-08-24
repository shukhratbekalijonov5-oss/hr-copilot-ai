package ai.hrcopilot.notification.events;

import ai.hrcopilot.notification.service.NotificationIngestService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Consumes the backend's notification events (notifications.events.v1).
 *
 * The producer is TRUSTED (the backend's own outbox over an internal
 * broker), but the payload is still validated field by field — a malformed
 * or truncated message is logged and ACKNOWLEDGED so it cannot wedge the
 * partition, while a persistence failure (DB down) throws and lets
 * spring-kafka redeliver: at-least-once delivery meets the event_id unique
 * constraint downstream, which is what makes redelivery harmless.
 */
@Component
public class NotificationEventsConsumer {

    private static final Logger log = LoggerFactory.getLogger(NotificationEventsConsumer.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final NotificationIngestService ingest;

    public NotificationEventsConsumer(NotificationIngestService ingest) {
        this.ingest = ingest;
    }

    @KafkaListener(
            topics = NotificationTopics.NOTIFICATION_EVENTS,
            groupId = "notification-service.events")
    public void onMessage(String raw) {
        JsonNode root = parse(raw);
        if (root == null) {
            return;
        }
        String eventId = text(root, "eventId");
        String eventType = text(root, "eventType");
        String recipientUserId = text(root, "recipientUserId");
        JsonNode context = root.path("context");
        if (eventId == null || eventType == null || recipientUserId == null
                || !context.isObject()) {
            log.error("notification event missing required fields; skipped");
            return;
        }
        String audience = context.path("audience").isTextual()
                ? context.path("audience").asText()
                : "CANDIDATE";
        String organizationId = context.path("organizationId").isTextual()
                ? context.path("organizationId").asText()
                : null;

        NotificationIngestService.Outcome outcome = ingest.ingest(
                new NotificationIngestService.IngestRequest(
                        eventId,
                        eventType,
                        recipientUserId,
                        organizationId,
                        audience,
                        context.toString()));
        if (outcome == NotificationIngestService.Outcome.DUPLICATE) {
            log.info("Duplicate notification event {} acknowledged", eventId);
        }
    }

    private JsonNode parse(String raw) {
        try {
            JsonNode node = MAPPER.readTree(raw);
            return node.isObject() ? node : null;
        } catch (Exception malformed) {
            log.error("notification event was not valid JSON; skipped");
            return null;
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isTextual() && !value.asText().isBlank() ? value.asText() : null;
    }
}
