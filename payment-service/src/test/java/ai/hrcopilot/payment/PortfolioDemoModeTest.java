package ai.hrcopilot.payment;

import static org.assertj.core.api.Assertions.assertThat;

import ai.hrcopilot.payment.repository.BillingAuditLogRepository;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * PORTFOLIO_DEMO_MODE on a PRODUCTION-profile boot: the plan switch works,
 * every switch is audited with source PORTFOLIO_DEMO, plan validation still
 * rejects unknown values, and nothing else about the production posture
 * changes (Toss stays the provider; MOCK is still refused by profile).
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "payment.internal-token=demo-mode-token",
            "payment.publish-enabled=false",
            "payment.portfolio-demo-mode=true",
            "payment.provider=TOSS",
            "payment.toss.client-key=test_ck_demo",
            "payment.toss.secret-key=test_sk_demo",
            "payment.toss.success-url=https://merchant.example/callbacks/toss/success",
            "payment.toss.fail-url=https://merchant.example/callbacks/toss/fail"
        })
@ActiveProfiles("prod")
class PortfolioDemoModeTest {

    // Same escape hatch as IntegrationTestBase: -Dtest.jdbc.url runs against
    // an existing database instead of starting a container.
    private static final String EXTERNAL_URL = System.getProperty("test.jdbc.url");

    private static final PostgreSQLContainer<?> POSTGRES =
            EXTERNAL_URL == null ? new PostgreSQLContainer<>("postgres:16-alpine") : null;

    static {
        if (POSTGRES != null) {
            POSTGRES.start();
        }
    }

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        if (POSTGRES == null) {
            registry.add("spring.datasource.url", () -> EXTERNAL_URL);
            registry.add("spring.datasource.username",
                    () -> System.getProperty("test.jdbc.username", "postgres"));
            registry.add("spring.datasource.password",
                    () -> System.getProperty("test.jdbc.password", "postgres"));
            return;
        }
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired
    private TestRestTemplate http;

    @Autowired
    private BillingAuditLogRepository audit;

    private ResponseEntity<Map> switchPlan(String userId, String plan) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Internal-Token", "demo-mode-token");
        headers.set("Content-Type", "application/json");
        return http.exchange(
                "/internal/dev/plan-switch",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("userId", userId, "plan", plan), headers),
                Map.class);
    }

    @Test
    @SuppressWarnings("unchecked")
    void demoModeSwitchesPlansAndAuditsAsPortfolioDemo() {
        String userId = "demo-" + UUID.randomUUID();
        ResponseEntity<Map> up = switchPlan(userId, "MAX");
        assertThat(up.getStatusCode().value()).isEqualTo(200);
        assertThat(up.getBody().get("plan")).isEqualTo("MAX");
        assertThat(up.getBody().get("changed")).isEqualTo(true);

        // Entitlements — the same authority the UI reads — reflect it.
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Internal-Token", "demo-mode-token");
        ResponseEntity<Map> entitlements = http.exchange(
                "/internal/entitlements/" + userId,
                HttpMethod.GET,
                new HttpEntity<>(headers),
                Map.class);
        assertThat(entitlements.getBody().get("plan")).isEqualTo("MAX");

        // Audit rows carry the explicit demo source, never a billing source.
        boolean audited = audit.findAll().stream()
                .anyMatch(row -> "PORTFOLIO_DEMO".equals(row.getActor())
                        && row.getDetail() != null
                        && row.getDetail().contains("MAX"));
        assertThat(audited).isTrue();
    }

    @Test
    void unknownPlanIsRejected() {
        assertThat(switchPlan("demo-x", "ENTERPRISE").getStatusCode().value())
                .isEqualTo(400);
    }

    @Test
    void missingServiceCredentialIsStillUnauthorized() {
        ResponseEntity<Map> response = http.exchange(
                "/internal/dev/plan-switch",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("userId", "x", "plan", "PRO"), new HttpHeaders()),
                Map.class);
        assertThat(response.getStatusCode().value()).isEqualTo(401);
    }
}
