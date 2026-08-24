package ai.hrcopilot.payment.events;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * The one event envelope every billing topic carries:
 *
 *   { eventId, eventType, eventVersion, occurredAt, userId, ...fields }
 *
 * Built here, once, so a topic cannot grow an envelope of its own. The
 * serialized JSON goes into the outbox row and is published byte-for-byte —
 * the publisher adds nothing, so what a consumer sees is exactly what the
 * originating transaction committed.
 */
public final class EventEnvelope {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private EventEnvelope() {
    }

    public static String serialize(String eventType, int eventVersion, String userId, Map<String, Object> fields) {
        ObjectNode node = MAPPER.createObjectNode();
        node.put("eventId", UUID.randomUUID().toString());
        node.put("eventType", eventType);
        node.put("eventVersion", eventVersion);
        node.put("occurredAt", Instant.now().toString());
        node.put("userId", userId);
        fields.forEach((key, value) -> {
            if (value == null) {
                node.putNull(key);
            } else {
                node.put(key, value.toString());
            }
        });
        return node.toString();
    }
}
