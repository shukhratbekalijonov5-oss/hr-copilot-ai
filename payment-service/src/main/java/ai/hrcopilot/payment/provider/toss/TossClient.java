package ai.hrcopilot.payment.provider.toss;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Minimal Toss Payments Core API client. It never logs Authorization or raw
 * provider bodies; callers receive only stable provider failure classes.
 */
public class TossClient {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final int MAX_RESPONSE_BYTES = 128_000;

    private final TossProperties properties;
    private final HttpClient http;

    public TossClient(TossProperties properties) {
        this(properties, HttpClient.newBuilder()
                .connectTimeout(properties.connectTimeout())
                .build());
    }

    TossClient(TossProperties properties, HttpClient http) {
        this.properties = properties;
        this.http = http;
    }

    public TossPayment createPayment(TossCreatePaymentRequest request, String idempotencyKey) {
        return post("/v1/payments", request.toBody(properties), idempotencyKey);
    }

    public TossPayment confirmPayment(TossConfirmPaymentRequest request, String idempotencyKey) {
        return post("/v1/payments/confirm", request.toBody(), idempotencyKey);
    }

    public TossPayment retrieveByPaymentKey(String paymentKey) {
        return get("/v1/payments/" + encode(paymentKey));
    }

    public TossPayment retrieveByOrderId(String orderId) {
        return get("/v1/payments/orders/" + encode(orderId));
    }

    private TossPayment post(String path, Object body, String idempotencyKey) {
        try {
            String json = MAPPER.writeValueAsString(body);
            HttpRequest request = base(path)
                    .header("Content-Type", "application/json")
                    .header("Idempotency-Key", idempotencyKey)
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();
            return send(request);
        } catch (IOException error) {
            throw new TossProviderException(TossProviderException.Kind.MALFORMED, "Could not encode Toss request");
        }
    }

    private TossPayment get(String path) {
        HttpRequest request = base(path).GET().build();
        return send(request);
    }

    private HttpRequest.Builder base(String path) {
        String token = Base64.getEncoder()
                .encodeToString((properties.secretKey() + ":").getBytes(StandardCharsets.UTF_8));
        return HttpRequest.newBuilder(properties.baseUri().resolve(path))
                .timeout(properties.requestTimeout())
                .header("Authorization", "Basic " + token)
                .header("Accept-Language", "en-US");
    }

    private TossPayment send(HttpRequest request) {
        try {
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            String body = response.body() == null ? "" : response.body();
            if (body.getBytes(StandardCharsets.UTF_8).length > MAX_RESPONSE_BYTES) {
                throw new TossProviderException(TossProviderException.Kind.MALFORMED, "Toss response was too large");
            }
            if (response.statusCode() >= 400 && response.statusCode() < 500) {
                throw new TossProviderException(TossProviderException.Kind.REJECTED, "Toss rejected the request");
            }
            if (response.statusCode() >= 500) {
                throw new TossProviderException(TossProviderException.Kind.UNAVAILABLE, "Toss is unavailable");
            }
            JsonNode node = MAPPER.readTree(body);
            return TossPayment.from(node);
        } catch (TossProviderException error) {
            throw error;
        } catch (IOException error) {
            throw new TossProviderException(TossProviderException.Kind.MALFORMED, "Malformed Toss response");
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new TossProviderException(TossProviderException.Kind.UNAVAILABLE, "Toss request interrupted");
        }
    }

    private static String encode(String raw) {
        return URLEncoder.encode(raw, StandardCharsets.UTF_8);
    }

    public record TossCreatePaymentRequest(
            String orderId,
            String orderName,
            int amountMinor,
            String currency,
            String successUrl,
            String failUrl) {
        Map<String, Object> toBody(TossProperties properties) {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("method", properties.method());
            body.put("amount", minorToTossAmount(amountMinor, currency));
            body.put("currency", currency);
            body.put("orderId", orderId);
            body.put("orderName", orderName);
            body.put("successUrl", successUrl);
            body.put("failUrl", failUrl);
            body.put("flowMode", "DEFAULT");
            if ("FOREIGN_EASY_PAY".equals(properties.method())) {
                body.put("provider", properties.foreignEasyPayProvider());
            }
            return body;
        }
    }

    public record TossConfirmPaymentRequest(
            String paymentKey, String orderId, int amountMinor, String currency) {
        Map<String, Object> toBody() {
            return Map.of(
                    "paymentKey", paymentKey,
                    "orderId", orderId,
                    "amount", minorToTossAmount(amountMinor, currency));
        }
    }

    public record TossPayment(
            String paymentKey,
            String orderId,
            String status,
            BigDecimal totalAmount,
            String currency,
            String checkoutUrl) {

        static TossPayment from(JsonNode node) {
            String paymentKey = textOrNull(node, "paymentKey");
            String orderId = textOrNull(node, "orderId");
            String status = textOrNull(node, "status");
            String currency = textOrNull(node, "currency");
            BigDecimal totalAmount = node.hasNonNull("totalAmount")
                    ? node.get("totalAmount").decimalValue()
                    : node.path("amount").decimalValue();
            String checkoutUrl = node.path("checkout").path("url").asText(null);
            if (orderId == null || status == null || currency == null) {
                throw new TossProviderException(TossProviderException.Kind.MALFORMED, "Toss payment was malformed");
            }
            return new TossPayment(paymentKey, orderId, status, totalAmount, currency, checkoutUrl);
        }

        /** The payment amount in its currency's minor unit (KRW has none). */
        public int amountMinor() {
            return tossAmountToMinor(totalAmount, currency);
        }
    }

    /** KRW is a zero-decimal currency: Toss amounts ARE the minor unit. */
    static BigDecimal minorToTossAmount(int amountMinor, String currency) {
        return "KRW".equals(currency)
                ? BigDecimal.valueOf(amountMinor)
                : BigDecimal.valueOf(amountMinor, 2).stripTrailingZeros();
    }

    static int tossAmountToMinor(BigDecimal amount, String currency) {
        return "KRW".equals(currency)
                ? amount.intValueExact()
                : amount.movePointRight(2).intValueExact();
    }

    private static String textOrNull(JsonNode node, String field) {
        return node.hasNonNull(field) ? node.get(field).asText() : null;
    }
}
