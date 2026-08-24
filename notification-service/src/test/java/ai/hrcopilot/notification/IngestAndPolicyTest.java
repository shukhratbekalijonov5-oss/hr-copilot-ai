package ai.hrcopilot.notification;

import static org.assertj.core.api.Assertions.assertThat;

import ai.hrcopilot.notification.domain.ChannelPolicy;
import ai.hrcopilot.notification.events.NotificationEventsConsumer;
import ai.hrcopilot.notification.repository.EmailDeliveryRepository;
import ai.hrcopilot.notification.repository.NotificationRepository;
import ai.hrcopilot.notification.repository.OutboxEventRepository;
import ai.hrcopilot.notification.service.NotificationIngestService;
import ai.hrcopilot.notification.support.IntegrationTestBase;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * The channel policy and the exactly-once ingest, against the real schema:
 * three email events, everything else in-app only, unknown types stored
 * defensively and never emailed, duplicates a database fact.
 */
class IngestAndPolicyTest extends IntegrationTestBase {

    @Autowired
    private NotificationIngestService ingest;

    @Autowired
    private NotificationEventsConsumer consumer;

    @Autowired
    private NotificationRepository notifications;

    @Autowired
    private EmailDeliveryRepository emails;

    @Autowired
    private OutboxEventRepository outbox;

    private NotificationIngestService.IngestRequest request(String eventId, String type, String user) {
        return new NotificationIngestService.IngestRequest(
                eventId, type, user, null, "CANDIDATE", "{\"vacancyTitle\":\"Backend Engineer\"}");
    }

    @Test
    void theThreeEmailEventsAndOnlyThoseRouteEmail() {
        assertThat(ChannelPolicy.effectiveRouteOf("ACCOUNT_CREATED").email()).isTrue();
        assertThat(ChannelPolicy.effectiveRouteOf("SUBSCRIPTION_ACTIVATED").email()).isTrue();
        assertThat(ChannelPolicy.effectiveRouteOf("SUBSCRIPTION_EXPIRES_IN_3_DAYS").email()).isTrue();
        for (String inAppOnly : new String[] {
            "NEW_APPLICATION", "NEW_MESSAGE", "INTERVIEW_INVITATION",
            "VACANCY_DELETED", "APPLICATION_REJECTED",
            "STRONG_AI_JOB_MATCH", "RESUME_PROCESSING_COMPLETED", "ANYTHING_FUTURE"
        }) {
            assertThat(ChannelPolicy.effectiveRouteOf(inAppOnly).email())
                    .as(inAppOnly + " must never email")
                    .isFalse();
        }
    }

    @Test
    void anInAppOnlyEventPersistsARowAndAnEchoButNeverAnEmail() {
        String user = "user-" + UUID.randomUUID();
        String eventId = "evt-" + UUID.randomUUID();
        long emailsBefore = emails.count();

        ingest.ingest(request(eventId, "INTERVIEW_INVITATION", user));

        var stored = notifications.findByEventId(eventId).orElseThrow();
        assertThat(stored.getType()).isEqualTo("INTERVIEW_INVITATION");
        assertThat(stored.isRead()).isFalse();
        assertThat(emails.count()).isEqualTo(emailsBefore); // NO email row
        assertThat(outbox.findAll()).anyMatch(event ->
                event.getPayload().contains(stored.getId().toString()));
    }

    @Test
    void accountCreatedIsEmailOnly() {
        String user = "user-" + UUID.randomUUID();
        String eventId = "evt-" + UUID.randomUUID();

        ingest.ingest(request(eventId, "ACCOUNT_CREATED", user));

        assertThat(notifications.findByEventId(eventId)).isEmpty(); // no in-app row
        var delivery = emails.findByEventIdAndEmailType(eventId, "ACCOUNT_CREATED").orElseThrow();
        assertThat(delivery.getStatus()).isEqualTo("PENDING");
        assertThat(delivery.getRecipientUserId()).isEqualTo(user);
    }

    @Test
    void subscriptionActivatedIsEmailAndInApp() {
        String user = "user-" + UUID.randomUUID();
        String eventId = "evt-" + UUID.randomUUID();

        ingest.ingest(request(eventId, "SUBSCRIPTION_ACTIVATED", user));

        assertThat(notifications.findByEventId(eventId)).isPresent();
        assertThat(emails.findByEventIdAndEmailType(eventId, "SUBSCRIPTION_ACTIVATED")).isPresent();
    }

    @Test
    void anUnknownTypeIsStoredInAppAndNeverEmailed() {
        String user = "user-" + UUID.randomUUID();
        String eventId = "evt-" + UUID.randomUUID();
        long emailsBefore = emails.count();

        ingest.ingest(request(eventId, "SOME_FUTURE_TYPE", user));

        assertThat(notifications.findByEventId(eventId)).isPresent();
        assertThat(emails.count()).isEqualTo(emailsBefore);
    }

    @Test
    void aDuplicateEventIsOneLogicalEffect() {
        String user = "user-" + UUID.randomUUID();
        String eventId = "evt-" + UUID.randomUUID();

        var first = ingest.ingest(request(eventId, "SUBSCRIPTION_ACTIVATED", user));
        long notificationsAfter = notifications.count();
        long emailsAfter = emails.count();
        long outboxAfter = outbox.count();
        var second = ingest.ingest(request(eventId, "SUBSCRIPTION_ACTIVATED", user));

        assertThat(first).isEqualTo(NotificationIngestService.Outcome.PROCESSED);
        assertThat(second).isEqualTo(NotificationIngestService.Outcome.DUPLICATE);
        assertThat(notifications.count()).isEqualTo(notificationsAfter);
        assertThat(emails.count()).isEqualTo(emailsAfter);
        assertThat(outbox.count()).isEqualTo(outboxAfter);
    }

    @Test
    void theKafkaConsumerParsesEnvelopesAndSkipsGarbageSafely() {
        String user = "user-" + UUID.randomUUID();
        String eventId = "evt-" + UUID.randomUUID();
        String envelope = "{\"eventId\":\"" + eventId + "\",\"eventVersion\":1,"
                + "\"eventType\":\"APPLICATION_REJECTED\",\"occurredAt\":\"2026-08-25T10:00:00Z\","
                + "\"recipientUserId\":\"" + user + "\","
                + "\"context\":{\"audience\":\"CANDIDATE\",\"vacancyTitle\":\"X\"}}";

        consumer.onMessage(envelope);
        consumer.onMessage(envelope); // Kafka redelivery
        consumer.onMessage("{not json");
        consumer.onMessage("{\"eventType\":\"X\"}"); // missing fields

        assertThat(notifications.findByEventId(eventId)).isPresent();
        assertThat(notifications.findAll().stream()
                        .filter(n -> user.equals(n.getRecipientUserId()))
                        .count())
                .isEqualTo(1);
    }
}
