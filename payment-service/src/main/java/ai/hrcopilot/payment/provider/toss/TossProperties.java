package ai.hrcopilot.payment.provider.toss;

import java.net.URI;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Toss Payments configuration. Secret key stays server-side only; client key
 * is stored separately so the two credentials cannot be confused.
 */
@ConfigurationProperties(prefix = "payment.toss")
public record TossProperties(
        String baseUrl,
        String clientKey,
        String secretKey,
        String successUrl,
        String failUrl,
        String browserSuccessUrl,
        String browserFailUrl,
        String method,
        String foreignEasyPayProvider,
        int connectTimeoutMs,
        int requestTimeoutMs) {

    public TossProperties {
        if (baseUrl == null || baseUrl.isBlank()) {
            baseUrl = "https://api.tosspayments.com";
        }
        if (method == null || method.isBlank()) {
            method = "FOREIGN_EASY_PAY";
        }
        if (foreignEasyPayProvider == null || foreignEasyPayProvider.isBlank()) {
            foreignEasyPayProvider = "PAYPAL";
        }
        // Where the BROWSER lands after the callback endpoints have done
        // their work. Fixed configuration, never request-derived — the
        // callback controller refuses to redirect anywhere else, which is
        // what rules out open-redirect by construction.
        if (browserSuccessUrl == null || browserSuccessUrl.isBlank()) {
            browserSuccessUrl = "/billing/success";
        }
        if (browserFailUrl == null || browserFailUrl.isBlank()) {
            browserFailUrl = "/billing/fail";
        }
        if (connectTimeoutMs <= 0) {
            connectTimeoutMs = 2_000;
        }
        if (requestTimeoutMs <= 0) {
            requestTimeoutMs = 5_000;
        }
    }

    public URI baseUri() {
        return URI.create(baseUrl.replaceAll("/+$", ""));
    }

    public Duration connectTimeout() {
        return Duration.ofMillis(connectTimeoutMs);
    }

    public Duration requestTimeout() {
        return Duration.ofMillis(requestTimeoutMs);
    }

    /**
     * CARD settles in KRW only: checkout charges the fixed per-plan won
     * amounts instead of the USD product price. FOREIGN_EASY_PAY/PAYPAL is
     * the USD path. Nothing else is supported.
     */
    public boolean krwCardMode() {
        return "CARD".equals(method);
    }

    public void validateForUse() {
        require(clientKey, "TOSS_PAYMENTS_CLIENT_KEY");
        require(secretKey, "TOSS_PAYMENTS_SECRET_KEY");
        require(successUrl, "TOSS_PAYMENTS_SUCCESS_URL");
        require(failUrl, "TOSS_PAYMENTS_FAIL_URL");
        boolean usdPaypal = "FOREIGN_EASY_PAY".equals(method) && "PAYPAL".equals(foreignEasyPayProvider);
        if (!usdPaypal && !krwCardMode()) {
            throw new IllegalStateException(
                    "Toss provider supports CARD (fixed KRW amounts) or FOREIGN_EASY_PAY/PAYPAL (USD) only");
        }
    }

    private static void require(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is required when PAYMENT_PROVIDER=TOSS");
        }
    }
}
