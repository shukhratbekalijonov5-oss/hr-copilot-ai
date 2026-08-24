package ai.hrcopilot.payment;

import static org.assertj.core.api.Assertions.assertThat;

import ai.hrcopilot.payment.repository.BillingAuditLogRepository;
import ai.hrcopilot.payment.repository.OutboxEventRepository;
import ai.hrcopilot.payment.repository.PaymentRepository;
import ai.hrcopilot.payment.support.IntegrationTestBase;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;

/**
 * Webhook exactly-once: the unique (provider, providerEventId) constraint,
 * inside the processing transaction, is what makes a redelivered event a
 * no-op — one transition, one audit trail, one set of outbox events.
 */
class WebhookIdempotencyTest extends IntegrationTestBase {

    @Autowired
    private TestRestTemplate http;

    @Autowired
    private OutboxEventRepository outbox;

    @Autowired
    private BillingAuditLogRepository audit;

    @Autowired
    private PaymentRepository payments;

    @Autowired
    private ai.hrcopilot.payment.service.WebhookProcessingService processing;

    private String sign(String body) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(WEBHOOK_SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return HexFormat.of().formatHex(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
    }

    @SuppressWarnings("unchecked")
    private ResponseEntity<Map> deliver(String body) throws Exception {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Content-Type", "application/json");
        headers.set("X-Mock-Signature", sign(body));
        return http.exchange("/webhooks/mock", HttpMethod.POST, new HttpEntity<>(body, headers), Map.class);
    }

    private String paymentSucceededBody(String eventId, String userId) {
        return "{\"providerEventId\":\"" + eventId + "\",\"type\":\"PAYMENT_SUCCEEDED\","
                + "\"userId\":\"" + userId + "\",\"plan\":\"MAX\","
                + "\"providerPaymentId\":\"pay_" + eventId + "\",\"amountCents\":1200,"
                + "\"currency\":\"USD\"}";
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> entitlements(String userId) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Internal-Token", INTERNAL_TOKEN);
        return http.exchange(
                        "/internal/entitlements/" + userId,
                        HttpMethod.GET,
                        new HttpEntity<>(headers),
                        Map.class)
                .getBody();
    }

    @Test
    void aVerifiedPaymentActivatesTheSubscriptionOnce() throws Exception {
        String userId = "wh-user-" + UUID.randomUUID();
        String eventId = "evt-" + UUID.randomUUID();
        String body = paymentSucceededBody(eventId, userId);

        ResponseEntity<Map> first = deliver(body);
        assertThat(first.getStatusCode().value()).isEqualTo(200);
        assertThat(first.getBody().get("outcome")).isEqualTo("PROCESSED");
        assertThat(entitlements(userId).get("plan")).isEqualTo("MAX");

        long outboxAfterFirst = outbox.count();
        long auditAfterFirst = audit.findByUserIdOrderByCreatedAtAsc(userId).size();
        long paymentsAfterFirst = payments.count();

        // The provider redelivers the SAME event.
        ResponseEntity<Map> second = deliver(body);
        assertThat(second.getBody().get("outcome")).isEqualTo("DUPLICATE");
        assertThat(second.getBody().get("duplicate")).isEqualTo(true);

        // One logical result: nothing was written twice, anywhere.
        assertThat(outbox.count()).isEqualTo(outboxAfterFirst);
        assertThat(audit.findByUserIdOrderByCreatedAtAsc(userId)).hasSize((int) auditAfterFirst);
        assertThat(payments.count()).isEqualTo(paymentsAfterFirst);
        assertThat(entitlements(userId).get("plan")).isEqualTo("MAX");
    }

    @Test
    void anUnsignedOrMissignedWebhookIsRejectedAndTouchesNothing() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Content-Type", "application/json");
        headers.set("X-Mock-Signature", "0000");
        String body = paymentSucceededBody("evt-forged", "wh-forged-user");
        ResponseEntity<String> response = http.exchange(
                "/webhooks/mock", HttpMethod.POST, new HttpEntity<>(body, headers), String.class);
        assertThat(response.getStatusCode().value()).isEqualTo(401);
        assertThat(entitlements("wh-forged-user").get("plan")).isEqualTo("FREE");
    }

    @Test
    void aRealProviderWebhookBodyCanNeverGrantAPlanDirectly() {
        // Structural rule under test: the direct userId/plan-from-body
        // branch exists ONLY for the sandbox provider. The same event
        // attributed to a real provider is recorded and ignored.
        String userId = "wh-real-provider-" + UUID.randomUUID();
        var event = new ai.hrcopilot.payment.provider.ProviderEvent(
                "evt-" + UUID.randomUUID(),
                ai.hrcopilot.payment.provider.ProviderEvent.PAYMENT_SUCCEEDED,
                userId,
                null, // no order we issued
                "MAX",
                "pay_" + UUID.randomUUID(),
                1200,
                "USD");
        var outcome = processing.process("TOSS", event, "{}");
        assertThat(outcome.name()).isEqualTo("IGNORED");
        assertThat(entitlements(userId).get("plan")).isEqualTo("FREE");
    }

    @Test
    void anUninterestingEventTypeIsRecordedButCausesNoTransition() throws Exception {
        String userId = "wh-ignored-" + UUID.randomUUID();
        String body = "{\"providerEventId\":\"evt-" + UUID.randomUUID()
                + "\",\"type\":\"PAYMENT_FAILED\",\"userId\":\"" + userId + "\"}";
        ResponseEntity<Map> response = deliver(body);
        assertThat(response.getBody().get("outcome")).isEqualTo("IGNORED");
        assertThat(entitlements(userId).get("plan")).isEqualTo("FREE");
    }
}
