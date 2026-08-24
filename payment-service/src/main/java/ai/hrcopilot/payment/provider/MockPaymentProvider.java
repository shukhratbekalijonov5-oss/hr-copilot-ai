package ai.hrcopilot.payment.provider;

import ai.hrcopilot.payment.config.PaymentServiceProperties;
import ai.hrcopilot.payment.domain.Plan;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * The sandbox provider: no network, no money, real discipline.
 *
 * Its webhook signature is a genuine HMAC-SHA256 over the raw body with a
 * configured secret — the same shape a real PSP verification takes — so the
 * verification path the tests exercise is the one a real provider will
 * reuse, not a stub that waves everything through. An unset secret means NO
 * webhook verifies (fail closed), which is also the production stance until
 * a real provider is deliberately configured.
 */
public class MockPaymentProvider implements PaymentProvider {

    public static final String NAME = "MOCK";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final PaymentServiceProperties properties;

    public MockPaymentProvider(PaymentServiceProperties properties) {
        this.properties = properties;
    }

    @Override
    public String name() {
        return NAME;
    }

    @Override
    public CheckoutSession createCheckout(CheckoutRequest request) {
        String checkoutId = "mock_co_" + UUID.randomUUID();
        return new CheckoutSession(checkoutId, "https://sandbox.invalid/checkout/" + checkoutId);
    }

    @Override
    public ProviderEvent confirmPayment(ConfirmationRequest request) {
        throw new UnsupportedOperationException("Mock checkout is completed by signed mock webhooks");
    }

    @Override
    public boolean verifyWebhookSignature(Map<String, String> headers, String rawBody) {
        String secret = properties.mockWebhookSecret();
        String provided = headers.get("x-mock-signature");
        if (secret == null || secret.isBlank() || provided == null || provided.isBlank()) {
            return false;
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            String expected = HexFormat.of().formatHex(mac.doFinal(rawBody.getBytes(StandardCharsets.UTF_8)));
            return MessageDigest.isEqual(
                    expected.getBytes(StandardCharsets.UTF_8), provided.getBytes(StandardCharsets.UTF_8));
        } catch (Exception impossible) {
            return false;
        }
    }

    @Override
    public Optional<ProviderEvent> parseEvent(String rawBody) {
        try {
            JsonNode node = MAPPER.readTree(rawBody);
            String eventId = node.path("providerEventId").asText(null);
            String type = node.path("type").asText(null);
            String userId = node.path("userId").asText(null);
            if (eventId == null || type == null || userId == null) {
                return Optional.empty();
            }
            return Optional.of(new ProviderEvent(
                    eventId,
                    type,
                    userId,
                    null,
                    node.path("plan").asText(null),
                    node.path("providerPaymentId").asText(null),
                    node.path("amountCents").asInt(0),
                    node.path("currency").asText("USD")));
        } catch (Exception malformed) {
            return Optional.empty();
        }
    }
}
