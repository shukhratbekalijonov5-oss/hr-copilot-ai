package ai.hrcopilot.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import ai.hrcopilot.payment.domain.Plan;
import ai.hrcopilot.payment.events.BillingTopics;
import ai.hrcopilot.payment.outbox.OutboxPublisher;
import ai.hrcopilot.payment.repository.OutboxEventRepository;
import ai.hrcopilot.payment.service.PlanSwitchService;
import ai.hrcopilot.payment.support.IntegrationTestBase;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.apache.kafka.clients.consumer.Consumer;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.ConsumerRecords;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.core.DefaultKafkaConsumerFactory;
import org.springframework.kafka.test.EmbeddedKafkaBroker;
import org.springframework.kafka.test.context.EmbeddedKafka;
import org.springframework.test.context.TestPropertySource;

/**
 * The publisher end-to-end against a real (embedded, in-JVM) Kafka broker:
 * a committed outbox row becomes exactly one message on its topic, carrying
 * the versioned envelope, and is then never published again.
 *
 * Embedded rather than Testcontainers for the broker: it exercises the same
 * producer path with no external image dependency; PostgreSQL — where the
 * outbox correctness actually lives — is a real container.
 */
@EmbeddedKafka(partitions = 1, topics = {BillingTopics.ENTITLEMENT_EVENTS})
@TestPropertySource(properties = {
    "spring.kafka.bootstrap-servers=${spring.embedded.kafka.brokers}",
    "payment.publish-enabled=true",
})
class OutboxKafkaPublishTest extends IntegrationTestBase {

    @Autowired
    private PlanSwitchService planSwitch;

    @Autowired
    private OutboxPublisher publisher;

    @Autowired
    private OutboxEventRepository outbox;

    @Autowired
    private EmbeddedKafkaBroker broker;

    @Test
    void aCommittedEventIsPublishedOnceWithTheVersionedEnvelope() throws Exception {
        String userId = "kafka-" + UUID.randomUUID();
        planSwitch.switchPlan(userId, Plan.MAX, "test");

        await().atMost(Duration.ofSeconds(15)).untilAsserted(() -> assertThat(
                        outbox.findAll().stream()
                                .filter(event -> event.getPayload().contains(userId))
                                .allMatch(event -> event.getPublishedAt() != null))
                .isTrue());

        Map<String, Object> props = new HashMap<>();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, broker.getBrokersAsString());
        props.put(ConsumerConfig.GROUP_ID_CONFIG, "assert-" + UUID.randomUUID());
        props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        try (Consumer<String, String> consumer = new DefaultKafkaConsumerFactory<>(
                        props, new StringDeserializer(), new StringDeserializer())
                .createConsumer()) {
            broker.consumeFromAnEmbeddedTopic(consumer, BillingTopics.ENTITLEMENT_EVENTS);
            ConsumerRecords<String, String> records = consumer.poll(Duration.ofSeconds(10));

            ConsumerRecord<String, String> match = null;
            int matches = 0;
            for (ConsumerRecord<String, String> record : records) {
                if (record.value().contains(userId)) {
                    matches += 1;
                    match = record;
                }
            }
            assertThat(matches).isEqualTo(1);

            // The envelope contract, field by field.
            JsonNode envelope = new ObjectMapper().readTree(match.value());
            assertThat(envelope.path("eventId").asText()).isNotBlank();
            assertThat(envelope.path("eventType").asText()).isEqualTo("ENTITLEMENT_CHANGED");
            assertThat(envelope.path("eventVersion").asInt()).isEqualTo(1);
            assertThat(envelope.path("occurredAt").asText()).isNotBlank();
            assertThat(envelope.path("userId").asText()).isEqualTo(userId);
            assertThat(envelope.path("plan").asText()).isEqualTo("MAX");

            // Another publisher tick republishes NOTHING.
            publisher.publishPending();
            ConsumerRecords<String, String> again = consumer.poll(Duration.ofSeconds(2));
            for (ConsumerRecord<String, String> record : again) {
                assertThat(record.value().contains(userId)).isFalse();
            }
        }
    }
}
