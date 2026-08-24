package ai.hrcopilot.payment;

import static org.assertj.core.api.Assertions.assertThat;

import ai.hrcopilot.payment.repository.CustomerBillingAccountRepository;
import ai.hrcopilot.payment.repository.PaymentRepository;
import ai.hrcopilot.payment.support.IntegrationTestBase;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
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
 * Races the money paths. Every guarantee here is a DATABASE fact (unique
 * constraints + row locks inside the processing transaction), so the
 * expected outcome of any race is "exactly one effective transition" —
 * never a duplicate payment, activation, audit trail, or outbox set.
 */
class ConcurrencyTest extends IntegrationTestBase {

    @Autowired
    private TestRestTemplate http;

    @Autowired
    private PaymentRepository payments;

    @Autowired
    private CustomerBillingAccountRepository accounts;

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

    @SuppressWarnings("unchecked")
    private ResponseEntity<Map> checkout(String userId, String plan, String key) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Internal-Token", INTERNAL_TOKEN);
        headers.set("Content-Type", "application/json");
        headers.set("Idempotency-Key", key);
        return http.exchange(
                "/internal/checkout",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("userId", userId, "plan", plan), headers),
                Map.class);
    }

    private <T> List<T> race(int threads, java.util.concurrent.Callable<T> task) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            CyclicBarrier gate = new CyclicBarrier(threads);
            List<Future<T>> futures = new ArrayList<>();
            for (int i = 0; i < threads; i++) {
                futures.add(pool.submit(() -> {
                    gate.await();
                    return task.call();
                }));
            }
            List<T> results = new ArrayList<>();
            for (Future<T> future : futures) {
                results.add(future.get());
            }
            return results;
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void concurrentCheckoutsWithTheSameKeyYieldOneOrder() throws Exception {
        String userId = "race-co-" + UUID.randomUUID();
        String key = "key-" + UUID.randomUUID();

        List<ResponseEntity<Map>> results = race(4, () -> checkout(userId, "MAX", key));

        List<Object> paymentIds = results.stream()
                .peek(response -> assertThat(response.getStatusCode().value()).isEqualTo(200))
                .map(response -> response.getBody().get("paymentId"))
                .distinct()
                .toList();
        assertThat(paymentIds).hasSize(1);

        var account = accounts.findByUserId(userId).orElseThrow();
        assertThat(payments.countByBillingAccountId(account.getId())).isEqualTo(1);
    }

    @Test
    void concurrentDeliveriesOfTheSameWebhookEventActivateOnce() throws Exception {
        String userId = "race-wh-" + UUID.randomUUID();
        String eventId = "evt-" + UUID.randomUUID();
        String body = "{\"providerEventId\":\"" + eventId + "\",\"type\":\"PAYMENT_SUCCEEDED\","
                + "\"userId\":\"" + userId + "\",\"plan\":\"MAX\","
                + "\"providerPaymentId\":\"pay_" + eventId + "\",\"amountCents\":1200,"
                + "\"currency\":\"USD\"}";

        List<ResponseEntity<Map>> results = race(4, () -> deliver(body));

        long processed = results.stream()
                .filter(response -> "PROCESSED".equals(response.getBody().get("outcome")))
                .count();
        long duplicates = results.stream()
                .filter(response -> "DUPLICATE".equals(response.getBody().get("outcome")))
                .count();
        assertThat(processed).isEqualTo(1);
        assertThat(duplicates).isEqualTo(3);

        // One settled payment row exists — the unique payment index held.
        assertThat(payments.findByProviderAndProviderPaymentId("MOCK", "pay_" + eventId)).isPresent();
    }

    @Test
    void aSecondEventForTheSamePaymentUnderANewEventIdIsStillOneActivation() throws Exception {
        // Same logical payment redelivered under a DIFFERENT eventId (the
        // nastier duplicate): the (provider, provider_payment_id) unique
        // index rolls the second transaction back to nothing.
        String userId = "race-dup-" + UUID.randomUUID();
        String paymentId = "pay_shared_" + UUID.randomUUID();
        String bodyTemplate = "{\"providerEventId\":\"%s\",\"type\":\"PAYMENT_SUCCEEDED\","
                + "\"userId\":\"" + userId + "\",\"plan\":\"PRO\","
                + "\"providerPaymentId\":\"" + paymentId + "\",\"amountCents\":700,"
                + "\"currency\":\"USD\"}";

        ResponseEntity<Map> first = deliver(bodyTemplate.formatted("evt-a-" + UUID.randomUUID()));
        ResponseEntity<Map> second = deliver(bodyTemplate.formatted("evt-b-" + UUID.randomUUID()));

        assertThat(first.getBody().get("outcome")).isEqualTo("PROCESSED");
        assertThat(second.getBody().get("outcome")).isEqualTo("DUPLICATE");
        assertThat(payments.findByProviderAndProviderPaymentId("MOCK", paymentId)).isPresent();
    }
}
