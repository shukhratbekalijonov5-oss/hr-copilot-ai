package ai.hrcopilot.payment;

import static org.assertj.core.api.Assertions.assertThat;

import ai.hrcopilot.payment.api.DevPlanSwitchController;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * PRODUCTION MUST NEVER allow direct plan switching — proven by booting the
 * application with the `prod` profile and observing that the dev switch
 * does not exist: no bean in the context, 404 on the route even WITH a
 * valid service credential. There is no flag that could re-enable it,
 * because there is nothing there to enable.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "payment.internal-token=prod-lockdown-token",
            "payment.publish-enabled=false",
            // prod refuses MOCK outright, so this boot carries a (dummy)
            // TOSS configuration — exactly what a real deployment must do.
            "payment.provider=TOSS",
            "payment.toss.client-key=test_ck_lockdown",
            "payment.toss.secret-key=test_sk_lockdown",
            "payment.toss.success-url=https://merchant.example/callbacks/toss/success",
            "payment.toss.fail-url=https://merchant.example/callbacks/toss/fail"
        })
@ActiveProfiles("prod")
class ProdProfileLockdownTest {

    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine");

    static {
        POSTGRES.start();
    }

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired
    private ApplicationContext context;

    @Autowired
    private TestRestTemplate http;

    @Test
    void theDevSwitchBeanDoesNotExistInProd() {
        assertThat(context.getBeanNamesForType(DevPlanSwitchController.class)).isEmpty();
    }

    @Test
    void theRouteIs404EvenWithAValidServiceCredential() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Internal-Token", "prod-lockdown-token");
        headers.set("Content-Type", "application/json");
        ResponseEntity<String> response = http.exchange(
                "/internal/dev/plan-switch",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("userId", "x", "plan", "MAX"), headers),
                String.class);
        assertThat(response.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void entitlementsStillWorkInProd() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Internal-Token", "prod-lockdown-token");
        ResponseEntity<Map> response = http.exchange(
                "/internal/entitlements/prod-user",
                HttpMethod.GET,
                new HttpEntity<>(headers),
                Map.class);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody().get("plan")).isEqualTo("FREE");
    }
}
