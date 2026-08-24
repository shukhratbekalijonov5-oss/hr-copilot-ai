package ai.hrcopilot.notification.events;

import ai.hrcopilot.notification.domain.ChannelPolicy;
import ai.hrcopilot.notification.service.NotificationIngestService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Consumes the Payment Service's subscription facts and maps VERIFIED
 * activations to SUBSCRIPTION_ACTIVATED (email + in-app).
 *
 * Only SUBSCRIPTION_ACTIVATED is acted on — scheduled downgrades,
 * cancellations and every other billing operational event stay in-app-less
 * and email-less here by design. The Payment Service emits activation only
 * for provider-verified payments, so no email can originate from a bare
 * checkout creation. Idempotency anchors on the billing eventId; Kafka
 * redelivery aborts on the unique constraint downstream.
 */
@Component
public class BillingSubscriptionEventsConsumer {

    private static final Logger log =
            LoggerFactory.getLogger(BillingSubscriptionEventsConsumer.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final NotificationIngestService ingest;

    public BillingSubscriptionEventsConsumer(NotificationIngestService ingest) {
        this.ingest = ingest;
    }

    /*
     * auto.offset.reset=latest, deliberately: the billing topic PREDATES
     * this service, and a brand-new consumer group must not replay months
     * of historical activations into fresh "your plan is active" emails.
     * Once the group has committed offsets, at-least-once resumes as usual.
     * (Our own notifications.events.v1 keeps `earliest`: that topic is born
     * with this service and every event on it is ours to store.)
     */
    @KafkaListener(
            topics = NotificationTopics.BILLING_SUBSCRIPTION_EVENTS,
            groupId = "notification-service.billing",
            properties = {"auto.offset.reset=latest"})
    public void onMessage(String raw) {
        JsonNode root;
        try {
            root = MAPPER.readTree(raw);
        } catch (Exception malformed) {
            log.error("billing event was not valid JSON; skipped");
            return;
        }
        if (!"SUBSCRIPTION_ACTIVATED".equals(root.path("eventType").asText())) {
            return; // Other billing facts are not notification material.
        }
        String eventId = root.path("eventId").asText(null);
        String userId = root.path("userId").asText(null);
        if (eventId == null || eventId.isBlank() || userId == null || userId.isBlank()) {
            log.error("SUBSCRIPTION_ACTIVATED event missing eventId/userId; skipped");
            return;
        }
        String plan = root.path("plan").asText("");

        ObjectNode context = MAPPER.createObjectNode();
        context.put("audience", "CANDIDATE");
        context.put("plan", plan);

        ingest.ingest(new NotificationIngestService.IngestRequest(
                "billing:" + eventId,
                ChannelPolicy.SUBSCRIPTION_ACTIVATED,
                userId,
                null,
                "CANDIDATE",
                context.toString()));
    }
}
