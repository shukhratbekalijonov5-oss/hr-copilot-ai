package ai.hrcopilot.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import ai.hrcopilot.payment.domain.Plan;
import ai.hrcopilot.payment.outbox.OutboxPublisher;
import ai.hrcopilot.payment.repository.OutboxEventRepository;
import ai.hrcopilot.payment.service.PlanSwitchService;
import ai.hrcopilot.payment.support.IntegrationTestBase;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * A broker outage delays events; it never loses them, never duplicates
 * them, and never touches the state that caused them.
 */
@TestPropertySource(properties = "payment.publish-enabled=true")
class OutboxRetryTest extends IntegrationTestBase {

    @MockitoBean
    private KafkaTemplate<String, String> kafka;

    @Autowired
    private PlanSwitchService planSwitch;

    @Autowired
    private OutboxPublisher publisher;

    @Autowired
    private OutboxEventRepository outbox;

    @Autowired
    private org.springframework.jdbc.core.JdbcTemplate jdbc;

    @Test
    void aFailedSendBacksOffThenTheNextDueTickSucceeds() {
        String userId = "retry-" + UUID.randomUUID();
        planSwitch.switchPlan(userId, Plan.PRO, "test");

        // Tick 1: the broker is down. The failure is counted, summarized,
        // and the row steps aside with a backoff window.
        when(kafka.send(anyString(), anyString(), anyString()))
                .thenReturn(CompletableFuture.failedFuture(new RuntimeException("broker down")));
        publisher.publishPending();

        var event = outbox.findAll().stream()
                .filter(candidate -> candidate.getPayload().contains(userId))
                .findFirst()
                .orElseThrow();
        assertThat(event.getPublishedAt()).isNull();
        assertThat(event.getAttemptCount()).isGreaterThanOrEqualTo(1);
        assertThat(event.getNextAttemptAt()).isAfter(java.time.Instant.now());
        int attemptsAfterFirst = event.getAttemptCount();

        // An immediate tick 2 does NOT retry — the row is inside its
        // backoff window, so a broker outage cannot hot-loop the publisher.
        publisher.publishPending();
        assertThat(outbox.findById(event.getId()).orElseThrow().getAttemptCount())
                .isEqualTo(attemptsAfterFirst);

        // The window elapses (simulated) and the broker recovered:
        // the SAME row publishes and settles. Nothing was discarded.
        jdbc.update("UPDATE outbox_events SET next_attempt_at = now() - interval '1 second' "
                + "WHERE id = ?", event.getId());
        when(kafka.send(anyString(), anyString(), anyString()))
                .thenReturn(CompletableFuture.completedFuture(null));
        publisher.publishPending();

        var settled = outbox.findById(event.getId()).orElseThrow();
        assertThat(settled.getPublishedAt()).isNotNull();
    }
}
