package ai.hrcopilot.payment;

import static org.assertj.core.api.Assertions.assertThat;

import ai.hrcopilot.payment.repository.BillingAuditLogRepository;
import ai.hrcopilot.payment.repository.OutboxEventRepository;
import ai.hrcopilot.payment.repository.PaymentRepository;
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

/** The dev/test switch: FREE ↔ PRO ↔ MAX, audited, evented, idempotent. */
class DevPlanSwitchTest extends IntegrationTestBase {

    @Autowired
    private TestRestTemplate http;

    @Autowired
    private BillingAuditLogRepository audit;

    @Autowired
    private OutboxEventRepository outbox;

    @Autowired
    private PaymentRepository payments;

    @Autowired
    private ai.hrcopilot.payment.repository.CustomerBillingAccountRepository accounts;

    private HttpHeaders authed() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Internal-Token", INTERNAL_TOKEN);
        headers.set("Content-Type", "application/json");
        return headers;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> switchPlan(String userId, String plan) {
        ResponseEntity<Map> response = http.exchange(
                "/internal/dev/plan-switch",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("userId", userId, "plan", plan), authed()),
                Map.class);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        return response.getBody();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> entitlements(String userId) {
        return http.exchange(
                        "/internal/entitlements/" + userId,
                        HttpMethod.GET,
                        new HttpEntity<>(authed()),
                        Map.class)
                .getBody();
    }

    @Test
    void freeToProToMaxToFree_eachImmediatelyVisible() {
        String userId = "switch-" + UUID.randomUUID();

        assertThat(switchPlan(userId, "PRO").get("changed")).isEqualTo(true);
        assertThat(entitlements(userId).get("plan")).isEqualTo("PRO");

        assertThat(switchPlan(userId, "MAX").get("changed")).isEqualTo(true);
        assertThat(entitlements(userId).get("plan")).isEqualTo("MAX");

        assertThat(switchPlan(userId, "FREE").get("changed")).isEqualTo(true);
        assertThat(entitlements(userId).get("plan")).isEqualTo("FREE");
    }

    @Test
    void switchingToTheCurrentPlanIsAnEventlessNoOp() {
        String userId = "idem-" + UUID.randomUUID();
        switchPlan(userId, "MAX");
        long auditBefore = audit.findByUserIdOrderByCreatedAtAsc(userId).size();
        long outboxBefore = outbox.count();

        Map<String, Object> repeat = switchPlan(userId, "MAX");

        assertThat(repeat.get("changed")).isEqualTo(false);
        assertThat(audit.findByUserIdOrderByCreatedAtAsc(userId)).hasSize((int) auditBefore);
        assertThat(outbox.count()).isEqualTo(outboxBefore);
    }

    @Test
    void everyTransitionIsAuditedAndEmitsExactlyOneEntitlementEvent() {
        String userId = "audit-" + UUID.randomUUID();
        switchPlan(userId, "PRO");
        switchPlan(userId, "MAX");

        List<ai.hrcopilot.payment.domain.entity.BillingAuditLog> entries =
                audit.findByUserIdOrderByCreatedAtAsc(userId);
        assertThat(entries).hasSize(2);
        assertThat(entries.get(0).getAction()).isEqualTo("PLAN_SWITCH");
        assertThat(entries.get(0).getDetail()).contains("\"from\":\"FREE\"").contains("\"to\":\"PRO\"");
        assertThat(entries.get(1).getDetail()).contains("\"from\":\"PRO\"").contains("\"to\":\"MAX\"");
        assertThat(entries.get(0).getActor()).isEqualTo("dev-plan-switch");

        long events = outbox.findAll().stream()
                .filter(event -> event.getPayload().contains(userId)
                        && "ENTITLEMENT_CHANGED".equals(event.getEventType()))
                .count();
        assertThat(events).isEqualTo(2);
    }

    @Test
    void devSwitchWritesNoFakePaymentRow() {
        String userId = "nopay-" + UUID.randomUUID();
        switchPlan(userId, "MAX");
        // The switch is a plan change, not a purchase: the fresh account it
        // created holds a subscription and ZERO payment rows.
        var account = accounts.findByUserId(userId).orElseThrow();
        assertThat(payments.countByBillingAccountId(account.getId())).isZero();
    }

    @Test
    void unknownPlanValueIsRejectedAtValidation() {
        ResponseEntity<String> response = http.exchange(
                "/internal/dev/plan-switch",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("userId", "x", "plan", "ULTRA"), authed()),
                String.class);
        assertThat(response.getStatusCode().value()).isEqualTo(400);
    }
}
