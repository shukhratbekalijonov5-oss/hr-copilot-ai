package ai.hrcopilot.payment;

import static org.assertj.core.api.Assertions.assertThat;

import ai.hrcopilot.payment.support.IntegrationTestBase;
import org.springframework.boot.test.autoconfigure.actuate.observability.AutoConfigureObservability;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/** Boot honesty: migrations ran, probes answer, metrics are real. */
@AutoConfigureObservability // @SpringBootTest disables metrics export by default.
class HealthAndFlywayTest extends IntegrationTestBase {

    @Autowired
    private TestRestTemplate http;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void healthAndReadinessAreUp() {
        ResponseEntity<Map> health = http.getForEntity("/actuator/health", Map.class);
        assertThat(health.getStatusCode().value()).isEqualTo(200);
        assertThat(health.getBody().get("status")).isEqualTo("UP");

        ResponseEntity<Map> readiness =
                http.getForEntity("/actuator/health/readiness", Map.class);
        assertThat(readiness.getStatusCode().value()).isEqualTo(200);
        assertThat(readiness.getBody().get("status")).isEqualTo("UP");
    }

    @Test
    void flywayAppliedTheFoundationMigrationCleanly() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT version, success FROM flyway_schema_history ORDER BY installed_rank");
        assertThat(rows).isNotEmpty();
        assertThat(rows.get(0).get("version")).isEqualTo("1");
        assertThat(rows).allSatisfy(row -> assertThat(row.get("success")).isEqualTo(true));
        // And the schema it claims to have built actually exists.
        assertThat(jdbc.queryForObject("SELECT count(*) FROM outbox_events", Long.class))
                .isNotNull();
    }

    @Test
    void prometheusExposesTheBillingMetrics() {
        String metrics = http.getForObject("/actuator/prometheus", String.class);
        // Micrometer name: outbox_pending_total. The Prometheus client keeps
        // the _total suffix for counters and strips it from gauges in the
        // scrape, so the gauge appears as outbox_pending here (and under its
        // full name at /actuator/metrics/outbox_pending_total).
        assertThat(metrics).contains("outbox_pending");
    }
}
