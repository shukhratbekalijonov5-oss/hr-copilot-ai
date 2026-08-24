package ai.hrcopilot.payment.outbox;

import ai.hrcopilot.payment.domain.entity.OutboxEvent;
import ai.hrcopilot.payment.events.EventEnvelope;
import ai.hrcopilot.payment.repository.OutboxEventRepository;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * The ONLY way a billing event is created: appended inside the caller's own
 * transaction. There is deliberately no KafkaTemplate anywhere near a state
 * transition — publishing is the outbox worker's job, after commit.
 */
@Component
public class OutboxWriter {

    private final OutboxEventRepository outbox;

    public OutboxWriter(OutboxEventRepository outbox) {
        this.outbox = outbox;
    }

    /** Must be called INSIDE an active transaction alongside the state change. */
    public void append(
            String topic,
            String aggregateType,
            String aggregateId,
            String eventType,
            String userId,
            Map<String, Object> fields) {
        int eventVersion = 1;
        String payload = EventEnvelope.serialize(eventType, eventVersion, userId, fields);
        outbox.save(OutboxEvent.pending(aggregateType, aggregateId, eventType, eventVersion, topic, payload));
    }
}
