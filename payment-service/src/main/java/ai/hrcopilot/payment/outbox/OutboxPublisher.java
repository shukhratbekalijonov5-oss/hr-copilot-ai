package ai.hrcopilot.payment.outbox;

import ai.hrcopilot.payment.config.PaymentServiceProperties;
import ai.hrcopilot.payment.domain.entity.OutboxEvent;
import ai.hrcopilot.payment.repository.OutboxEventRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Publishes committed outbox rows to Kafka — the asynchronous half of the
 * transactional outbox.
 *
 * Each tick locks a bounded batch of pending rows with SKIP LOCKED (two
 * instances partition the backlog; nothing is published twice from the
 * table), sends each event synchronously, and marks success per-row. A
 * failed send increments the row's attempt count and leaves it pending —
 * a Kafka outage delays events, it never loses them and never blocks an
 * API request, because no API request ever waits on this loop.
 *
 * Delivery is therefore AT-LEAST-ONCE: a crash between broker-ack and the
 * published_at commit re-sends that event. Consumers must dedupe on
 * eventId, which the envelope carries for exactly this reason.
 */
@Component
public class OutboxPublisher {

    private static final Logger log = LoggerFactory.getLogger(OutboxPublisher.class);

    private final OutboxEventRepository outbox;
    private final KafkaTemplate<String, String> kafka;
    private final TransactionTemplate transactions;
    private final PaymentServiceProperties properties;
    private final Counter publishFailures;

    public OutboxPublisher(
            OutboxEventRepository outbox,
            KafkaTemplate<String, String> kafka,
            TransactionTemplate transactions,
            PaymentServiceProperties properties,
            MeterRegistry meters) {
        this.outbox = outbox;
        this.kafka = kafka;
        this.transactions = transactions;
        this.properties = properties;
        this.publishFailures = Counter.builder("outbox_publish_failure_total").register(meters);
        Gauge.builder("outbox_pending_total", outbox, OutboxEventRepository::countByPublishedAtIsNull)
                .description("Outbox events not yet published to Kafka")
                .register(meters);
        Gauge.builder(
                        "outbox_stuck_total",
                        outbox,
                        repository -> repository.countByPublishedAtIsNullAndAttemptCountGreaterThanEqual(8))
                .description("Outbox events still unpublished after 8+ attempts")
                .register(meters);
    }

    @Scheduled(fixedDelayString = "${payment.outbox-poll-ms:2000}")
    public void publishPending() {
        if (!properties.publishEnabled()) {
            return;
        }
        transactions.executeWithoutResult(ignored -> {
            List<OutboxEvent> batch = outbox.lockPendingBatch(
                    java.time.Instant.now(), PageRequest.of(0, properties.outboxBatchSize()));
            for (OutboxEvent event : batch) {
                try {
                    kafka.send(event.getTopic(), event.getAggregateId(), event.getPayload())
                            .get(10, TimeUnit.SECONDS);
                    event.markPublished();
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    event.markFailed("interrupted");
                    publishFailures.increment();
                    return;
                } catch (Exception failure) {
                    event.markFailed(failure.getMessage());
                    publishFailures.increment();
                    log.warn("Outbox publish failed for {} (attempt {}): {}",
                            event.getId(), event.getAttemptCount(), failure.getClass().getSimpleName());
                }
            }
            outbox.saveAll(batch);
        });
    }
}
