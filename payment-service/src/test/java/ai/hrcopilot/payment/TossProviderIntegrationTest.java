package ai.hrcopilot.payment;

import static org.assertj.core.api.Assertions.assertThat;

import ai.hrcopilot.payment.domain.entity.Payment;
import ai.hrcopilot.payment.repository.BillingAuditLogRepository;
import ai.hrcopilot.payment.repository.OutboxEventRepository;
import ai.hrcopilot.payment.repository.PaymentRepository;
import ai.hrcopilot.payment.support.IntegrationTestBase;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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

class TossProviderIntegrationTest extends IntegrationTestBase {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String TOSS_SECRET = "test_sk_toss_secret";
    private static final FakeToss TOSS = FakeToss.start();

    @Autowired
    private TestRestTemplate http;

    @org.springframework.boot.test.web.server.LocalServerPort
    private int port;

    @Autowired
    private PaymentRepository payments;

    @Autowired
    private BillingAuditLogRepository audit;

    @Autowired
    private OutboxEventRepository outbox;

    @DynamicPropertySource
    static void tossProperties(DynamicPropertyRegistry registry) {
        registry.add("payment.provider", () -> "TOSS");
        registry.add("payment.toss.base-url", TOSS::baseUrl);
        registry.add("payment.toss.client-key", () -> "test_ck_unused_by_server");
        registry.add("payment.toss.secret-key", () -> TOSS_SECRET);
        registry.add("payment.toss.success-url", () -> "https://merchant.example/callbacks/toss/success");
        registry.add("payment.toss.fail-url", () -> "https://merchant.example/callbacks/toss/fail");
        registry.add("payment.toss.browser-success-url", () -> "https://frontend.example/billing/success");
        registry.add("payment.toss.browser-fail-url", () -> "https://frontend.example/billing/fail");
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
    void checkoutUsesTossAuthServerPriceAndSafeOrderId() throws Exception {
        String userId = "toss-checkout-" + UUID.randomUUID();
        Map<String, Object> body = checkout(userId, "PRO", "idem-" + UUID.randomUUID());

        assertThat(body.get("redirectUrl").toString()).startsWith("https://checkout.toss.test/");
        assertThat(body.get("checkoutId").toString()).matches("hrc_[A-Fa-f0-9]{32}");

        FakeToss.Captured create = TOSS.last("/v1/payments");
        assertThat(create.authorization())
                .isEqualTo("Basic " + Base64.getEncoder().encodeToString((TOSS_SECRET + ":")
                        .getBytes(StandardCharsets.UTF_8)));
        JsonNode request = MAPPER.readTree(create.body());
        assertThat(request.path("method").asText()).isEqualTo("FOREIGN_EASY_PAY");
        assertThat(request.path("provider").asText()).isEqualTo("PAYPAL");
        assertThat(request.path("currency").asText()).isEqualTo("USD");
        assertThat(request.path("amount").decimalValue()).isEqualByComparingTo("7");
        assertThat(request.path("orderId").asText()).isEqualTo(body.get("checkoutId"));
    }

    @Test
    void checkoutIdempotencyReusesTheSameTossOrder() {
        String userId = "toss-idem-" + UUID.randomUUID();
        String key = "idem-" + UUID.randomUUID();
        Map<String, Object> first = checkout(userId, "MAX", key);
        Map<String, Object> second = checkout(userId, "MAX", key);

        assertThat(second.get("paymentId")).isEqualTo(first.get("paymentId"));
        assertThat(second.get("checkoutId")).isEqualTo(first.get("checkoutId"));
        assertThat(second.get("reused")).isEqualTo(true);
    }

    @Test
    void validConfirmationActivatesSubscriptionAndOutboxExactlyOnce() {
        String userId = "toss-confirm-" + UUID.randomUUID();
        Map<String, Object> checkout = checkout(userId, "MAX", "idem-" + UUID.randomUUID());
        String orderId = checkout.get("checkoutId").toString();
        String paymentKey = "pay_" + UUID.randomUUID();

        ResponseEntity<Map> first = confirm(paymentKey, orderId, "12.00");
        assertThat(first.getStatusCode().value()).isEqualTo(200);
        assertThat(first.getBody().get("outcome")).isEqualTo("PROCESSED");
        assertThat(entitlements(userId).get("plan")).isEqualTo("MAX");

        long outboxAfterFirst = outbox.count();
        long auditAfterFirst = audit.findByUserIdOrderByCreatedAtAsc(userId).size();
        Payment payment = payments.findByProviderAndProviderCheckoutId("TOSS", orderId).orElseThrow();
        assertThat(payment.getStatus()).isEqualTo("SUCCEEDED");
        assertThat(payment.getProviderPaymentId()).isEqualTo(paymentKey);

        ResponseEntity<Map> duplicate = confirm(paymentKey, orderId, "12");
        assertThat(duplicate.getBody().get("duplicate")).isEqualTo(true);
        assertThat(outbox.count()).isEqualTo(outboxAfterFirst);
        assertThat(audit.findByUserIdOrderByCreatedAtAsc(userId)).hasSize((int) auditAfterFirst);
    }

    @Test
    void incorrectAmountAndUnknownOrderAreRejectedBeforeActivation() {
        String userId = "toss-bad-" + UUID.randomUUID();
        Map<String, Object> checkout = checkout(userId, "PRO", "idem-" + UUID.randomUUID());

        ResponseEntity<Map> amount = confirm("pay_bad_amount", checkout.get("checkoutId").toString(), "8.00");
        assertThat(amount.getStatusCode().value()).isEqualTo(400);
        assertThat(entitlements(userId).get("plan")).isEqualTo("FREE");

        ResponseEntity<Map> order = confirm("pay_bad_order", "hrc_" + "0".repeat(32), "7.00");
        assertThat(order.getStatusCode().value()).isEqualTo(400);
    }

    @Test
    void providerErrorsAndMalformedJsonDoNotExposeRawTossBody() {
        String userId = "toss-provider-error-" + UUID.randomUUID();
        String orderId = checkout(userId, "PRO", "idem-" + UUID.randomUUID()).get("checkoutId").toString();

        ResponseEntity<String> rejected = http.exchange(
                "/internal/toss/confirm",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("paymentKey", "force-4xx", "orderId", orderId, "amount", "7"),
                        internalHeaders()),
                String.class);
        assertThat(rejected.getStatusCode().value()).isEqualTo(502);
        assertThat(rejected.getBody()).doesNotContain("TOSS_RAW_SECRET");

        ResponseEntity<String> malformed = http.exchange(
                "/internal/toss/confirm",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("paymentKey", "force-malformed", "orderId", orderId, "amount", "7"),
                        internalHeaders()),
                String.class);
        assertThat(malformed.getStatusCode().value()).isEqualTo(502);
        assertThat(entitlements(userId).get("plan")).isEqualTo("FREE");
    }

    /** A browser GET against the callback endpoints, redirects NOT followed. */
    private java.net.http.HttpResponse<Void> browserGet(String pathAndQuery) throws Exception {
        java.net.http.HttpClient browser = java.net.http.HttpClient.newBuilder()
                .followRedirects(java.net.http.HttpClient.Redirect.NEVER)
                .build();
        return browser.send(
                java.net.http.HttpRequest.newBuilder(
                                java.net.URI.create("http://127.0.0.1:" + port + pathAndQuery))
                        .GET()
                        .build(),
                java.net.http.HttpResponse.BodyHandlers.discarding());
    }

    @Test
    void successCallbackConfirmsThenRedirectsTheBrowserToTheConfiguredTarget() throws Exception {
        String userId = "toss-cb-ok-" + UUID.randomUUID();
        String orderId = checkout(userId, "PRO", "idem-" + UUID.randomUUID()).get("checkoutId").toString();
        String paymentKey = "pay_cb_" + UUID.randomUUID();

        var response = browserGet("/callbacks/toss/success?paymentKey=" + paymentKey
                + "&orderId=" + orderId + "&amount=7.00");

        assertThat(response.statusCode()).isEqualTo(302);
        assertThat(response.headers().firstValue("Location").orElseThrow())
                .isEqualTo("https://frontend.example/billing/success");
        assertThat(entitlements(userId).get("plan")).isEqualTo("PRO");
    }

    @Test
    void aTamperedCallbackRedirectsToTheFixedFailTargetAndGrantsNothing() throws Exception {
        String userId = "toss-cb-bad-" + UUID.randomUUID();
        String orderId = checkout(userId, "PRO", "idem-" + UUID.randomUUID()).get("checkoutId").toString();

        // Wrong amount: never JSON, never exception text — a fixed redirect.
        var tampered = browserGet("/callbacks/toss/success?paymentKey=pay_x&orderId="
                + orderId + "&amount=1.00");
        assertThat(tampered.statusCode()).isEqualTo(302);
        assertThat(tampered.headers().firstValue("Location").orElseThrow())
                .isEqualTo("https://frontend.example/billing/fail?reason=confirmation_failed");
        assertThat(entitlements(userId).get("plan")).isEqualTo("FREE");

        // The fail callback is a redirect too, whatever Toss appended.
        var failed = browserGet("/callbacks/toss/fail?code=PAY_PROCESS_CANCELED&message=x");
        assertThat(failed.statusCode()).isEqualTo(302);
        assertThat(failed.headers().firstValue("Location").orElseThrow())
                .isEqualTo("https://frontend.example/billing/fail?reason=payment_failed");
    }

    @Test
    void aTransientStatusWebhookChangesNothingAndTheFinalConfirmStillLands() {
        String userId = "toss-transient-" + UUID.randomUUID();
        String orderId = checkout(userId, "MAX", "idem-" + UUID.randomUUID()).get("checkoutId").toString();
        String paymentKey = "pay_transient_" + UUID.randomUUID();
        TOSS.markStatus(paymentKey, orderId, 1200, "IN_PROGRESS");

        HttpHeaders headers = new HttpHeaders();
        headers.set("Content-Type", "application/json");
        headers.set("tosspayments-webhook-transmission-id", "tr_" + UUID.randomUUID());
        headers.set("tosspayments-webhook-transmission-time", "2026-08-24T00:00:00Z");
        String body = "{\"eventType\":\"PAYMENT_STATUS_CHANGED\",\"data\":{\"paymentKey\":\""
                + paymentKey + "\",\"orderId\":\"" + orderId + "\",\"status\":\"IN_PROGRESS\"}}";
        ResponseEntity<Map> response = http.exchange(
                "/webhooks/toss", HttpMethod.POST, new HttpEntity<>(body, headers), Map.class);

        // Non-final truth: recorded, ignored, and the payment is NOT failed.
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody().get("outcome")).isEqualTo("IGNORED");
        Payment payment = payments.findByProviderAndProviderCheckoutId("TOSS", orderId).orElseThrow();
        assertThat(payment.getStatus()).isEqualTo("PENDING");

        // The customer finishes; the real confirm still lands.
        ResponseEntity<Map> confirmed = confirm(paymentKey, orderId, "12.00");
        assertThat(confirmed.getBody().get("outcome")).isEqualTo("PROCESSED");
        assertThat(entitlements(userId).get("plan")).isEqualTo("MAX");
    }

    @Test
    void concurrentConfirmationsOfOnePaymentActivateExactlyOnce() throws Exception {
        String userId = "toss-race-" + UUID.randomUUID();
        String orderId = checkout(userId, "MAX", "idem-" + UUID.randomUUID()).get("checkoutId").toString();
        String paymentKey = "pay_race_" + UUID.randomUUID();

        var pool = java.util.concurrent.Executors.newFixedThreadPool(4);
        try {
            var gate = new java.util.concurrent.CyclicBarrier(4);
            java.util.List<java.util.concurrent.Future<ResponseEntity<Map>>> futures =
                    new java.util.ArrayList<>();
            for (int i = 0; i < 4; i++) {
                futures.add(pool.submit(() -> {
                    gate.await();
                    return confirm(paymentKey, orderId, "12.00");
                }));
            }
            int processed = 0;
            int duplicates = 0;
            for (var future : futures) {
                ResponseEntity<Map> response = future.get();
                assertThat(response.getStatusCode().value()).isEqualTo(200);
                if ("PROCESSED".equals(response.getBody().get("outcome"))) {
                    processed += 1;
                } else if ("DUPLICATE".equals(response.getBody().get("outcome"))) {
                    duplicates += 1;
                }
            }
            assertThat(processed).isEqualTo(1);
            assertThat(duplicates).isEqualTo(3);
        } finally {
            pool.shutdownNow();
        }

        // Exactly one activation trail exists.
        assertThat(entitlements(userId).get("plan")).isEqualTo("MAX");
        assertThat(audit.findByUserIdOrderByCreatedAtAsc(userId).stream()
                        .filter(entry -> "SUBSCRIPTION_ACTIVATED".equals(entry.getAction()))
                        .count())
                .isEqualTo(1);
    }

    @Test
    void tossWebhookRequiresTransmissionHeadersAndRefetchesTruth() {
        String userId = "toss-webhook-" + UUID.randomUUID();
        String orderId = checkout(userId, "MAX", "idem-" + UUID.randomUUID()).get("checkoutId").toString();
        String paymentKey = "pay_webhook_" + UUID.randomUUID();
        TOSS.markDone(paymentKey, orderId, 1200);

        String body = "{\"eventType\":\"PAYMENT_STATUS_CHANGED\",\"data\":{\"paymentKey\":\""
                + paymentKey + "\",\"orderId\":\"" + orderId + "\",\"status\":\"DONE\"}}";
        HttpHeaders unsigned = new HttpHeaders();
        unsigned.set("Content-Type", "application/json");
        ResponseEntity<String> rejected = http.exchange(
                "/webhooks/toss", HttpMethod.POST, new HttpEntity<>(body, unsigned), String.class);
        assertThat(rejected.getStatusCode().value()).isEqualTo(401);

        HttpHeaders headers = new HttpHeaders();
        headers.set("Content-Type", "application/json");
        headers.set("tosspayments-webhook-transmission-id", "tr_" + UUID.randomUUID());
        headers.set("tosspayments-webhook-transmission-time", "2026-08-24T00:00:00Z");
        ResponseEntity<String> accepted = http.exchange(
                "/webhooks/toss", HttpMethod.POST, new HttpEntity<>(body, headers), String.class);
        assertThat(accepted.getStatusCode().value()).as(accepted.getBody()).isEqualTo(200);
        assertThat(entitlements(userId).get("plan")).isEqualTo("MAX");
    }

    private static final class FakeToss {
        private final HttpServer server;
        private final List<Captured> captured = java.util.Collections.synchronizedList(new ArrayList<>());
        private final Map<String, TossRecord> payments = new java.util.concurrent.ConcurrentHashMap<>();

        private FakeToss(HttpServer server) {
            this.server = server;
        }

        static FakeToss start() {
            try {
                HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
                FakeToss fake = new FakeToss(server);
                server.createContext("/v1/payments", fake::handlePayments);
                server.start();
                return fake;
            } catch (IOException error) {
                throw new IllegalStateException(error);
            }
        }

        String baseUrl() {
            return "http://127.0.0.1:" + server.getAddress().getPort();
        }

        void stop() {
            server.stop(0);
        }

        Captured last(String path) {
            return captured.stream()
                    .filter(item -> item.path().equals(path))
                    .reduce((first, second) -> second)
                    .orElseThrow();
        }

        void markDone(String paymentKey, String orderId, int amount) {
            markStatus(paymentKey, orderId, amount, "DONE");
        }

        void markStatus(String paymentKey, String orderId, int amount, String status) {
            payments.put(paymentKey, new TossRecord(paymentKey, orderId, amount, status));
        }

        private void handlePayments(HttpExchange exchange) throws IOException {
            String path = exchange.getRequestURI().getPath();
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            captured.add(new Captured(path, exchange.getRequestHeaders().getFirst("Authorization"), body));

            if (path.equals("/v1/payments") && exchange.getRequestMethod().equals("POST")) {
                JsonNode request = MAPPER.readTree(body);
                String orderId = request.path("orderId").asText();
                int amount = request.path("amount").decimalValue().movePointRight(2).intValueExact();
                respond(exchange, 200, paymentJson(null, orderId, amount, "READY"));
                return;
            }
            if (path.equals("/v1/payments/confirm") && exchange.getRequestMethod().equals("POST")) {
                JsonNode request = MAPPER.readTree(body);
                String paymentKey = request.path("paymentKey").asText();
                if ("force-4xx".equals(paymentKey)) {
                    respond(exchange, 400, "{\"code\":\"REJECTED\",\"message\":\"TOSS_RAW_SECRET\"}");
                    return;
                }
                if ("force-malformed".equals(paymentKey)) {
                    respond(exchange, 200, "{not-json");
                    return;
                }
                String orderId = request.path("orderId").asText();
                int amount = request.path("amount").decimalValue().movePointRight(2).intValueExact();
                payments.put(paymentKey, new TossRecord(paymentKey, orderId, amount, "DONE"));
                respond(exchange, 200, paymentJson(paymentKey, orderId, amount, "DONE"));
                return;
            }
            if (path.startsWith("/v1/payments/") && exchange.getRequestMethod().equals("GET")) {
                String paymentKey = path.substring("/v1/payments/".length());
                TossRecord record = payments.get(paymentKey);
                if (record == null) {
                    respond(exchange, 404, "{\"code\":\"NOT_FOUND\",\"message\":\"TOSS_RAW_SECRET\"}");
                    return;
                }
                respond(exchange, 200, paymentJson(record.paymentKey(), record.orderId(), record.amount(), record.status()));
                return;
            }
            respond(exchange, 404, "{}");
        }

        private static String paymentJson(String paymentKey, String orderId, int amountCents, String status) {
            String key = paymentKey == null ? "null" : "\"" + paymentKey + "\"";
            return "{\"paymentKey\":" + key + ",\"orderId\":\"" + orderId
                    + "\",\"status\":\"" + status + "\",\"currency\":\"USD\",\"totalAmount\":"
                    + (amountCents / 100) + ",\"checkout\":{\"url\":\"https://checkout.toss.test/" + orderId + "\"}}";
        }

        private static void respond(HttpExchange exchange, int status, String body) throws IOException {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        }

        record Captured(String path, String authorization, String body) {
        }

        record TossRecord(String paymentKey, String orderId, int amount, String status) {
        }
    }
}
