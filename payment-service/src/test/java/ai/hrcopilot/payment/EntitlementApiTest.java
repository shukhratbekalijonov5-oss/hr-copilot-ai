package ai.hrcopilot.payment;

import static org.assertj.core.api.Assertions.assertThat;

import ai.hrcopilot.payment.domain.Plan;
import ai.hrcopilot.payment.service.PlanSwitchService;
import ai.hrcopilot.payment.support.IntegrationTestBase;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The entitlement contract: plan → capabilities exactly as the NestJS
 * policy table defines them, and fail-closed everywhere truth is missing.
 */
class EntitlementApiTest extends IntegrationTestBase {

    @Autowired
    private TestRestTemplate http;

    @Autowired
    private PlanSwitchService planSwitch;

    @Autowired
    private JdbcTemplate jdbc;

    @SuppressWarnings("unchecked")
    private Map<String, Object> entitlements(String userId) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Internal-Token", INTERNAL_TOKEN);
        ResponseEntity<Map> response = http.exchange(
                "/internal/entitlements/" + userId,
                HttpMethod.GET,
                new HttpEntity<>(headers),
                Map.class);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        return response.getBody();
    }

    @Test
    void aUserWithNoBillingHistoryIsFree() {
        Map<String, Object> body = entitlements("user-never-seen-" + UUID.randomUUID());
        assertThat(body.get("plan")).isEqualTo("FREE");
        assertThat((List<String>) body.get("capabilities")).isEmpty();
        assertThat(body.get("subscriptionStatus")).isEqualTo("NONE");
    }

    @Test
    void proGrantsExactlyInternalAiSearch() {
        String userId = "user-pro-" + UUID.randomUUID();
        planSwitch.switchPlan(userId, Plan.PRO, "test");
        Map<String, Object> body = entitlements(userId);
        assertThat(body.get("plan")).isEqualTo("PRO");
        assertThat((List<String>) body.get("capabilities"))
                .containsExactly("INTERNAL_AI_SEARCH");
        assertThat(body.get("subscriptionStatus")).isEqualTo("ACTIVE");
    }

    @Test
    void maxGrantsBothCapabilities() {
        String userId = "user-max-" + UUID.randomUUID();
        planSwitch.switchPlan(userId, Plan.MAX, "test");
        Map<String, Object> body = entitlements(userId);
        assertThat(body.get("plan")).isEqualTo("MAX");
        assertThat((List<String>) body.get("capabilities"))
                .containsExactly("INTERNAL_AI_SEARCH", "EXTERNAL_AI_SEARCH");
        assertThat(body.get("userId")).isEqualTo(userId);
        assertThat((Number) body.get("version")).isNotNull();
    }

    @Test
    void corruptOrFutureStateFailsClosedToFree() {
        String userId = "user-corrupt-" + UUID.randomUUID();
        planSwitch.switchPlan(userId, Plan.MAX, "test");
        // A plan value this deployment does not know — written by a future
        // version, or corruption. It must grant NOTHING, not throw.
        jdbc.update(
                "UPDATE subscriptions SET current_plan = 'ULTRA' WHERE billing_account_id = "
                        + "(SELECT id FROM customer_billing_accounts WHERE user_id = ?)",
                userId);

        Map<String, Object> body = entitlements(userId);
        assertThat(body.get("plan")).isEqualTo("FREE");
        assertThat((List<String>) body.get("capabilities")).isEmpty();
        assertThat(body.get("subscriptionStatus")).isEqualTo("UNKNOWN");
    }

    @Test
    void internalRoutesRejectMissingAndWrongCredentials() {
        ResponseEntity<String> missing =
                http.getForEntity("/internal/entitlements/anyone", String.class);
        assertThat(missing.getStatusCode().value()).isEqualTo(401);

        HttpHeaders wrong = new HttpHeaders();
        wrong.set("X-Internal-Token", "not-the-token");
        assertThat(http.exchange(
                        "/internal/entitlements/anyone",
                        HttpMethod.GET,
                        new HttpEntity<>(wrong),
                        String.class)
                .getStatusCode()
                .value())
                .isEqualTo(401);
    }
}
