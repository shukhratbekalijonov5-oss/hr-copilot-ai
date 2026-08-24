package ai.hrcopilot.payment.provider.toss;

import ai.hrcopilot.payment.domain.Plan;
import ai.hrcopilot.payment.provider.PaymentProvider;
import ai.hrcopilot.payment.provider.ProviderEvent;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.Optional;

/**
 * Toss Payments sandbox provider. It uses the official server-created hosted
 * payment window API, then confirms only with the server-derived order/amount.
 */
public class TossPaymentProvider implements PaymentProvider {

    public static final String NAME = "TOSS";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final TossClient client;
    private final TossProperties properties;

    public TossPaymentProvider(TossClient client, TossProperties properties) {
        this.client = client;
        this.properties = properties;
    }

    @Override
    public String name() {
        return NAME;
    }

    @Override
    public Price checkoutPrice(Plan plan) {
        // CARD settles in KRW only. The won amounts are FIXED per plan
        // (Plan.monthlyPriceKrw) — a pricing decision, never live FX.
        return properties.krwCardMode()
                ? new Price(plan.monthlyPriceKrw(), "KRW")
                : new Price(plan.monthlyPriceCents(), "USD");
    }

    @Override
    public CheckoutSession createCheckout(CheckoutRequest request) {
        String expectedCurrency = properties.krwCardMode() ? "KRW" : "USD";
        if (!expectedCurrency.equals(request.currency())) {
            throw new TossProviderException(
                    TossProviderException.Kind.REJECTED,
                    "Toss provider is configured for " + expectedCurrency + " only");
        }
        TossClient.TossPayment payment = client.createPayment(
                new TossClient.TossCreatePaymentRequest(
                        request.providerOrderId(),
                        request.orderName(),
                        request.amountCents(),
                        request.currency(),
                        properties.successUrl(),
                        properties.failUrl()),
                request.idempotencyKey());
        if (payment.checkoutUrl() == null || payment.checkoutUrl().isBlank()) {
            throw new TossProviderException(TossProviderException.Kind.MALFORMED, "Toss checkout URL was missing");
        }
        if (!request.providerOrderId().equals(payment.orderId())) {
            throw new TossProviderException(TossProviderException.Kind.MALFORMED, "Toss echoed a different orderId");
        }
        return new CheckoutSession(payment.orderId(), payment.checkoutUrl());
    }

    @Override
    public ProviderEvent confirmPayment(ConfirmationRequest request) {
        TossClient.TossPayment payment = client.confirmPayment(
                new TossClient.TossConfirmPaymentRequest(
                        request.paymentKey(),
                        request.providerOrderId(),
                        request.amountCents(),
                        request.currency()),
                "confirm_" + request.providerOrderId());
        return eventFromPayment("confirm:" + request.providerOrderId(), payment, null);
    }

    @Override
    public boolean verifyWebhookSignature(Map<String, String> headers, String rawBody) {
        /*
         * Toss documents signatures only for payout.changed and seller.changed;
         * PAYMENT_STATUS_CHANGED carries transmission headers but no signature.
         * Treat this as a notification only: parseEvent re-fetches payment
         * truth over authenticated Toss API before returning a success event.
         */
        return headers.containsKey("tosspayments-webhook-transmission-id")
                && headers.containsKey("tosspayments-webhook-transmission-time")
                && rawBody != null
                && !rawBody.isBlank();
    }

    @Override
    public Optional<ProviderEvent> parseEvent(String rawBody) {
        try {
            JsonNode root = MAPPER.readTree(rawBody);
            String eventType = root.path("eventType").asText("");
            if (!"PAYMENT_STATUS_CHANGED".equals(eventType)) {
                return Optional.of(new ProviderEvent(
                        eventId(root),
                        ProviderEvent.PAYMENT_FAILED,
                        null,
                        null,
                        null,
                        null,
                        0,
                        "USD"));
            }
            JsonNode data = root.path("data");
            String paymentKey = data.path("paymentKey").asText(null);
            String orderId = data.path("orderId").asText(null);
            TossClient.TossPayment fetched = paymentKey != null && !paymentKey.isBlank()
                    ? client.retrieveByPaymentKey(paymentKey)
                    : client.retrieveByOrderId(orderId);
            return Optional.of(eventFromPayment(eventId(root), fetched, null));
        } catch (Exception malformedOrUntrusted) {
            return Optional.empty();
        }
    }

    /** Toss statuses that are not yet final — see the docs' Payment object. */
    private static final java.util.Set<String> TRANSIENT_STATUSES =
            java.util.Set.of("READY", "IN_PROGRESS", "WAITING_FOR_DEPOSIT");

    private ProviderEvent eventFromPayment(String eventId, TossClient.TossPayment payment, Plan plan) {
        // DONE is the only success. READY/IN_PROGRESS/WAITING_FOR_DEPOSIT are
        // TRANSIENT: mapping them to a failure would permanently kill a
        // payment the customer is still completing. Everything else
        // (CANCELED, PARTIAL_CANCELED, ABORTED, EXPIRED) is final failure.
        String type = "DONE".equals(payment.status())
                ? ProviderEvent.PAYMENT_SUCCEEDED
                : TRANSIENT_STATUSES.contains(payment.status())
                        ? ProviderEvent.PAYMENT_PENDING
                        : ProviderEvent.PAYMENT_FAILED;
        return new ProviderEvent(
                eventId,
                type,
                null,
                payment.orderId(),
                plan == null ? null : plan.name(),
                payment.paymentKey(),
                payment.amountMinor(),
                payment.currency());
    }

    private static String eventId(JsonNode root) {
        String transmissionId = root.path("id").asText(null);
        if (transmissionId != null && !transmissionId.isBlank()) {
            return transmissionId;
        }
        String orderId = root.path("data").path("orderId").asText("unknown-order");
        String status = root.path("data").path("status").asText("unknown-status");
        return "toss:" + orderId + ":" + status;
    }
}
