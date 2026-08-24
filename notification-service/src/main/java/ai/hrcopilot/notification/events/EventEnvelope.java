package ai.hrcopilot.notification.events;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * The envelope this service publishes on notifications.created.v1:
 *
 *   { eventId, eventType, eventVersion, occurredAt, recipientUserId,
 *     notification: {…the full row view…} }
 *
 * Unlike the flat billing envelope, `notification` is a NESTED object —
 * serialized with Jackson so structure survives byte-for-byte into the
 * outbox row and out to the consumer.
 */
public final class EventEnvelope {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private EventEnvelope() {
    }

    public static String serialize(
            String eventType, int eventVersion, String recipientUserId, Map<String, Object> fields) {
        ObjectNode node = MAPPER.createObjectNode();
        node.put("eventId", UUID.randomUUID().toString());
        node.put("eventType", eventType);
        node.put("eventVersion", eventVersion);
        node.put("occurredAt", Instant.now().toString());
        node.put("recipientUserId", recipientUserId);
        fields.forEach((key, value) -> node.set(key, MAPPER.valueToTree(value)));
        return node.toString();
    }
}
