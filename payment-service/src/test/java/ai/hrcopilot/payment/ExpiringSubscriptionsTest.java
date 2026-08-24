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
 * The expiry read the Notification Service schedules reminders from: only
 * PAID subscriptions with a period end inside the window appear; FREE and
 * far-future periods do not; the surface demands the service credential.
 */
class ExpiringSubscriptionsTest extends IntegrationTestBase {

    @Autowired
    private TestRestTemplate http;

    @Autowired
    private PlanSwitchService planSwitch;

    @Autowired
    private JdbcTemplate jdbc;

    private void movePeriodEnd(String userId, String interval) {
        jdbc.update(
                "UPDATE subscriptions SET current_period_end = now() + interval '" + interval
                        + "' WHERE billing_account_id = "
                        + "(SELECT id FROM customer_billing_accounts WHERE user_id = ?)",
                userId);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> expiring() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Internal-Token", INTERNAL_TOKEN);
        ResponseEntity<Map> response = http.exchange(
                "/internal/subscriptions/expiring?withinDays=3",
                HttpMethod.GET,
                new HttpEntity<>(headers),
                Map.class);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        return (List<Map<String, Object>>) response.getBody().get("subscriptions");
    }

    @Test
    void onlyPaidSubscriptionsInsideTheWindowAreListed() {
        String dueUser = "expiring-due-" + UUID.randomUUID();
        String farUser = "expiring-far-" + UUID.randomUUID();
        String freeUser = "expiring-free-" + UUID.randomUUID();
        planSwitch.switchPlan(dueUser, Plan.MAX, "test");
        planSwitch.switchPlan(farUser, Plan.PRO, "test");
        planSwitch.switchPlan(freeUser, Plan.FREE, "test");
        movePeriodEnd(dueUser, "2 days");
        movePeriodEnd(freeUser, "2 days");

        List<Map<String, Object>> due = expiring();
        assertThat(due).anySatisfy(row -> {
            assertThat(row.get("userId")).isEqualTo(dueUser);
            assertThat(row.get("plan")).isEqualTo("MAX");
            assertThat(row.get("subscriptionId")).isNotNull();
            assertThat(row.get("currentPeriodEnd")).isNotNull();
        });
        assertThat(due).noneMatch(row -> farUser.equals(row.get("userId")));
        assertThat(due).noneMatch(row -> freeUser.equals(row.get("userId")));
    }

    @Test
    void theSurfaceDemandsTheServiceCredential() {
        ResponseEntity<String> response = http.getForEntity(
                "/internal/subscriptions/expiring", String.class);
        assertThat(response.getStatusCode().value()).isEqualTo(401);
    }
}
