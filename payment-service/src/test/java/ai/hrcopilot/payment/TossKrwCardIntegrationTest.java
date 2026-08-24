package ai.hrcopilot.payment;

import static org.assertj.core.api.Assertions.assertThat;

import ai.hrcopilot.payment.repository.OutboxEventRepository;
import ai.hrcopilot.payment.support.IntegrationTestBase;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * The KRW card mode end to end inside the service: fixed won amounts reach
 * Toss (9,900 / 16,900 — a pricing decision, never FX), confirm validates
 * whole-won amounts, activation grants the plan, and replaying the confirm
 * is a duplicate, not a second activation.
 */
class TossKrwCardIntegrationTest extends IntegrationTestBase {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final FakeKrwToss TOSS = FakeKrwToss.start();

    @Autowired
    private TestRestTemplate http;

    @Autowired
    private OutboxEventRepository outbox;

    @DynamicPropertySource
    static void tossProperties(DynamicPropertyRegistry registry) {
        registry.add("payment.provider", () -> "TOSS");
        registry.add("payment.toss.method", () -> "CARD");
        registry.add("payment.toss.base-url", TOSS::baseUrl);
        registry.add("payment.toss.client-key", () -> "test_ck_unused_by_server");
        registry.add("payment.toss.secret-key", () -> "test_sk_krw_secret");
        registry.add("payment.toss.success-url", () -> "https://merchant.example/callbacks/toss/success");
        registry.add("payment.toss.fail-url", () -> "https://merchant.example/callbacks/toss/fail");
        registry.add("payment.toss.browser-success-url", () -> "https://frontend.example/plans?checkout=success");
        registry.add("payment.toss.browser-fail-url", () -> "https://frontend.example/plans");
        registry.add("payment.toss.request-timeout-ms", () -> "1000");
    }

    @AfterAll
    static void stopToss() {
        TOSS.stop();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> checkout(String userId, String plan, String key) {
        HttpHeaders headers = internalHeaders();
        headers.set("Idempotency-Key", key);
        ResponseEntity<Map> response = http.exchange(
                "/internal/checkout",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("userId", userId, "plan", plan), headers),
                Map.class);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        return response.getBody();
    }

    @SuppressWarnings("unchecked")
    private ResponseEntity<Map> confirm(String paymentKey, String orderId, String amount) {
        return http.exchange(
                "/internal/toss/confirm",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("paymentKey", paymentKey, "orderId", orderId, "amount", amount),
                        internalHeaders()),
                Map.class);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> entitlements(String userId) {
        return http.exchange(
                        "/internal/entitlements/" + userId,
                        HttpMethod.GET,
                        new HttpEntity<>(internalHeaders()),
                        Map.class)
                .getBody();
    }

    private HttpHeaders internalHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Internal-Token", INTERNAL_TOKEN);
        headers.set("Content-Type", "application/json");
        return headers;
    }

    @Test
    void checkoutSendsFixedWholeWonCardRequest() throws Exception {
        Map<String, Object> body = checkout("krw-co-" + UUID.randomUUID(), "PRO", "idem-" + UUID.randomUUID());
        JsonNode request = MAPPER.readTree(TOSS.lastCreateBody);
        assertThat(request.path("method").asText()).isEqualTo("CARD");
        assertThat(request.path("currency").asText()).isEqualTo("KRW");
        assertThat(request.path("amount").decimalValue()).isEqualByComparingTo("9900");
        assertThat(request.has("provider")).isFalse();
        assertThat(request.path("orderId").asText()).isEqualTo(body.get("checkoutId"));
    }

    @Test
    void confirmActivatesProAtExactly9900WonAndReplayIsDuplicate() {
        String userId = "krw-pro-" + UUID.randomUUID();
        Map<String, Object> body = checkout(userId, "PRO", "idem-" + UUID.randomUUID());
        String orderId = body.get("checkoutId").toString();

        // Wrong amount is refused before any provider call.
        assertThat(confirm("pay_" + orderId, orderId, "9901").getStatusCode().value()).isEqualTo(400);

        ResponseEntity<Map> first = confirm("pay_" + orderId, orderId, "9900");
        assertThat(first.getStatusCode().value()).isEqualTo(200);
        assertThat(first.getBody().get("duplicate")).isEqualTo(false);

        Map<String, Object> granted = entitlements(userId);
        assertThat(granted.get("plan")).isEqualTo("PRO");
        assertThat((Iterable<String>) granted.get("capabilities")).contains("INTERNAL_AI_SEARCH");

        // Replay: same paymentKey → duplicate, no second activation event.
        ResponseEntity<Map> replay = confirm("pay_" + orderId, orderId, "9900");
        assertThat(replay.getStatusCode().value()).isEqualTo(200);
        assertThat(replay.getBody().get("duplicate")).isEqualTo(true);

        long activations = outbox.findAll().stream()
                .filter(e -> "SUBSCRIPTION_ACTIVATED".equals(e.getEventType()))
                .filter(e -> e.getPayload().contains(userId))
                .count();
        assertThat(activations).isEqualTo(1);
    }

    @Test
    void confirmActivatesMaxAtExactly16900Won() {
        String userId = "krw-max-" + UUID.randomUUID();
        Map<String, Object> body = checkout(userId, "MAX", "idem-" + UUID.randomUUID());
        String orderId = body.get("checkoutId").toString();

        ResponseEntity<Map> confirmed = confirm("pay_" + orderId, orderId, "16900");
        assertThat(confirmed.getStatusCode().value()).isEqualTo(200);

        Map<String, Object> granted = entitlements(userId);
        assertThat(granted.get("plan")).isEqualTo("MAX");
        assertThat((Iterable<String>) granted.get("capabilities"))
                .contains("INTERNAL_AI_SEARCH", "EXTERNAL_AI_SEARCH");
    }

    /** Minimal Toss double speaking whole-won KRW like the real test API. */
    static final class FakeKrwToss {
        private final HttpServer server;
        volatile String lastCreateBody = "";
        private final Map<String, Integer> confirmed = new ConcurrentHashMap<>();

        private FakeKrwToss(HttpServer server) {
            this.server = server;
        }

        static FakeKrwToss start() {
            try {
                HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
                FakeKrwToss toss = new FakeKrwToss(server);
                server.createContext("/v1/payments/confirm", exchange -> {
                    JsonNode request = MAPPER.readTree(new String(
                            exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                    String orderId = request.path("orderId").asText();
                    int amount = request.path("amount").decimalValue().intValueExact();
                    toss.confirmed.put(orderId, amount);
                    respond(exchange, 200, paymentJson(request.path("paymentKey").asText(), orderId, amount, "DONE"));
                });
                server.createContext("/v1/payments", exchange -> {
                    String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                    toss.lastCreateBody = body;
                    JsonNode request = MAPPER.readTree(body);
                    respond(exchange, 200, paymentJson(
                            null,
                            request.path("orderId").asText(),
                            request.path("amount").decimalValue().intValueExact(),
                            "READY"));
                });
                server.start();
                return toss;
            } catch (IOException error) {
                throw new IllegalStateException(error);
            }
        }

        private static String paymentJson(String paymentKey, String orderId, int amountWon, String status) {
            return "{" + (paymentKey == null ? "" : "\"paymentKey\":\"" + paymentKey + "\",")
                    + "\"orderId\":\"" + orderId
                    + "\",\"status\":\"" + status + "\",\"currency\":\"KRW\",\"totalAmount\":"
                    + amountWon + ",\"checkout\":{\"url\":\"https://checkout.toss.test/" + orderId + "\"}}";
        }

        private static void respond(com.sun.net.httpserver.HttpExchange exchange, int status, String body)
                throws IOException {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        }

        String baseUrl() {
            return "http://127.0.0.1:" + server.getAddress().getPort();
        }

        void stop() {
            server.stop(0);
        }
    }
}
