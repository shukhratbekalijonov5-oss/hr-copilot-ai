package ai.hrcopilot.payment.provider;

import ai.hrcopilot.payment.domain.Plan;
import java.util.Map;
import java.util.Optional;

/**
 * The seam a real PSP (Toss, Stripe, ...) plugs into later.
 *
 * Nothing outside this package may talk to a provider SDK or endpoint —
 * services consume this interface only, so swapping the sandbox for a real
 * provider is a new implementation plus configuration, not a refactor. No
 * credential is hardcoded anywhere; a provider that needs one reads it from
 * configuration and refuses to operate without it.
 */
public interface PaymentProvider {

    /** Stable provider name, stored on payments and webhook events. */
    String name();

    /**
     * The server-authoritative charge for a plan through THIS provider.
     * Amounts are in the currency's minor unit (USD → cents, KRW → won,
     * which has no subunit). The default is the USD product price; a
     * provider limited to another settlement currency overrides this with
     * its fixed configured amounts — never a live FX conversion.
     */
    default Price checkoutPrice(Plan plan) {
        return new Price(plan.monthlyPriceCents(), "USD");
    }

    /** Create a checkout the user can complete. */
    CheckoutSession createCheckout(CheckoutRequest request);

    /**
     * Confirm an authenticated provider payment. The amount/order check is
     * performed before this call; provider implementations must still send the
     * same server-derived values to the PSP.
     */
    ProviderEvent confirmPayment(ConfirmationRequest request);

    /**
     * Verify a webhook genuinely came from this provider. MUST be checked
     * before the body is parsed or acted on; an unverifiable delivery is
     * rejected, never processed "just in case".
     */
    boolean verifyWebhookSignature(Map<String, String> headers, String rawBody);

    /** Parse a verified webhook body into the provider-neutral event. */
    Optional<ProviderEvent> parseEvent(String rawBody);

    record CheckoutRequest(
            String userId,
            Plan plan,
            int amountCents,
            String currency,
            String providerOrderId,
            String orderName,
            String idempotencyKey) {
    }

    record CheckoutSession(String checkoutId, String redirectUrl) {
    }

    /** A charge amount in the currency's minor unit plus its currency. */
    record Price(int amountMinor, String currency) {
    }

    record ConfirmationRequest(
            String providerOrderId,
            String paymentKey,
            int amountCents,
            String currency) {
    }
}
