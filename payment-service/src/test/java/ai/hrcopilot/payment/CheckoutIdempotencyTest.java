package ai.hrcopilot.payment;

import static org.assertj.core.api.Assertions.assertThat;

import ai.hrcopilot.payment.repository.CustomerBillingAccountRepository;
import ai.hrcopilot.payment.repository.PaymentRepository;
import ai.hrcopilot.payment.support.IntegrationTestBase;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;

/** Same user + same Idempotency-Key → the SAME order, never a duplicate. */
class CheckoutIdempotencyTest extends IntegrationTestBase {

    @Autowired
    private TestRestTemplate http;

    @Autowired
    private PaymentRepository payments;

    @Autowired
    private CustomerBillingAccountRepository accounts;

    @SuppressWarnings("unchecked")
    private Map<String, Object> checkout(String userId, String plan, String key) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Internal-Token", INTERNAL_TOKEN);
        headers.set("Content-Type", "application/json");
        headers.set("Idempotency-Key", key);
        ResponseEntity<Map> response = http.exchange(
                "/internal/checkout",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("userId", userId, "plan", plan), headers),
                Map.class);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        return response.getBody();
    }

    @Test
    void theSameKeyReturnsTheSameOrder() {
        String userId = "co-" + UUID.randomUUID();
        String key = "key-" + UUID.randomUUID();

        Map<String, Object> first = checkout(userId, "MAX", key);
        Map<String, Object> retry = checkout(userId, "MAX", key);

        assertThat(retry.get("paymentId")).isEqualTo(first.get("paymentId"));
        assertThat(retry.get("checkoutId")).isEqualTo(first.get("checkoutId"));
        assertThat(retry.get("reused")).isEqualTo(true);

        var account = accounts.findByUserId(userId).orElseThrow();
        assertThat(payments.countByBillingAccountId(account.getId())).isEqualTo(1);
    }

    @Test
    void aDifferentKeyIsADifferentOrder() {
        String userId = "co2-" + UUID.randomUUID();
        Map<String, Object> first = checkout(userId, "PRO", "key-a-" + UUID.randomUUID());
        Map<String, Object> second = checkout(userId, "PRO", "key-b-" + UUID.randomUUID());
        assertThat(second.get("paymentId")).isNotEqualTo(first.get("paymentId"));
    }

    @Test
    void freeHasNothingToPurchase() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Internal-Token", INTERNAL_TOKEN);
        headers.set("Content-Type", "application/json");
        headers.set("Idempotency-Key", "k");
        ResponseEntity<String> response = http.exchange(
                "/internal/checkout",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("userId", "u", "plan", "FREE"), headers),
                String.class);
        assertThat(response.getStatusCode().value()).isEqualTo(400);
    }

    @Test
    void aMissingIdempotencyKeyIsRejected() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Internal-Token", INTERNAL_TOKEN);
        headers.set("Content-Type", "application/json");
        ResponseEntity<String> response = http.exchange(
                "/internal/checkout",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("userId", "u", "plan", "MAX"), headers),
                String.class);
        assertThat(response.getStatusCode().value()).isEqualTo(400);
    }
}
