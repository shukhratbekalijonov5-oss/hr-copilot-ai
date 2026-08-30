package ai.hrcopilot.notification.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Service configuration. Every credential arrives from the environment;
 * blank values fail CLOSED (internal endpoints reject everything, outbound
 * lookups refuse to run).
 *
 * @param internalToken     inbound credential for /internal/** (NestJS BFF)
 * @param backendBaseUrl    NestJS base URL incl. its /api prefix — recipient lookup
 * @param backendToken      credential for the backend user-lookup endpoint
 * @param paymentBaseUrl    Payment Service base URL — expiring-subscriptions read
 * @param paymentToken      credential for the Payment Service internal API
 * @param emailProvider     RESEND (production), SMTP, or LOG (refused in prod)
 * @param resendApiKey      Resend credential; required when provider=RESEND, never logged
 * @param resendApiUrl      Resend send endpoint (overridable so tests never call the internet)
 * @param fromAddress       full "Name <address>" From header; wins over fromName/fromEmail
 * @param fromEmail         From address for every product email
 * @param fromName          From display name
 * @param appPublicUrl      public web origin used for the emails' single CTA link
 * @param emailSendTimeoutMs per-request timeout for the provider API call
 * @param emailPollMs       email delivery worker poll interval
 * @param emailBatchSize    deliveries attempted per worker tick
 * @param outboxPollMs      created-echo outbox publisher interval
 * @param outboxBatchSize   outbox events per publisher tick
 * @param publishEnabled    master switch for the Kafka outbox publisher
 * @param expiryEnabled     master switch for the expiry-reminder scheduler
 * @param expiryPollMs      expiry scheduler poll interval
 * @param expiryWindowDays  reminder window (product: 3 days)
 * @param lookupTimeoutMs   HTTP timeout for backend/payment internal calls
 */
@ConfigurationProperties(prefix = "notification")
public record NotificationServiceProperties(
        String internalToken,
        String backendBaseUrl,
        String backendToken,
        String paymentBaseUrl,
        String paymentToken,
        Provider emailProvider,
        String resendApiKey,
        String resendApiUrl,
        String fromAddress,
        String fromEmail,
        String fromName,
        String appPublicUrl,
        int emailSendTimeoutMs,
        long emailPollMs,
        int emailBatchSize,
        long outboxPollMs,
        int outboxBatchSize,
        boolean publishEnabled,
        boolean expiryEnabled,
        long expiryPollMs,
        int expiryWindowDays,
        int lookupTimeoutMs) {

    public NotificationServiceProperties {
        if (emailProvider == null) {
            emailProvider = Provider.LOG;
        }
        if (fromEmail == null || fromEmail.isBlank()) {
            fromEmail = "no-reply@hrcopilot.local";
        }
        if (fromName == null || fromName.isBlank()) {
            fromName = "HR Copilot AI";
        }
        if (resendApiUrl == null || resendApiUrl.isBlank()) {
            resendApiUrl = "https://api.resend.com/emails";
        }
        if (appPublicUrl == null || appPublicUrl.isBlank()) {
            appPublicUrl = "https://hrcopilot.cloud";
        }
        // Trailing slashes would double up in every rendered link.
        appPublicUrl = appPublicUrl.replaceAll("/+$", "");
        if (emailSendTimeoutMs <= 0) {
            emailSendTimeoutMs = 10_000;
        }
        if (emailPollMs <= 0) {
            emailPollMs = 2_000;
        }
        if (emailBatchSize <= 0) {
            emailBatchSize = 10;
        }
        if (outboxPollMs <= 0) {
            outboxPollMs = 500;
        }
        if (outboxBatchSize <= 0) {
            outboxBatchSize = 50;
        }
        if (expiryPollMs <= 0) {
            expiryPollMs = 15 * 60_000;
        }
        if (expiryWindowDays <= 0) {
            expiryWindowDays = 3;
        }
        if (lookupTimeoutMs <= 0) {
            lookupTimeoutMs = 3_000;
        }
    }

    /**
     * The From header every provider uses. An explicit EMAIL_FROM
     * ("HR Copilot AI <no-reply@hrcopilot.cloud>") wins outright; otherwise
     * it is composed from the name/address pair. CR/LF can never survive —
     * a From header is still a header.
     */
    public String fromHeader() {
        String composed = (fromAddress != null && !fromAddress.isBlank())
                ? fromAddress
                : fromName + " <" + fromEmail + ">";
        return composed.replaceAll("[\\r\\n]", " ").trim();
    }

    /** The bare address, parsed out of fromAddress when that form is used. */
    public String senderEmail() {
        if (fromAddress == null || fromAddress.isBlank()) {
            return fromEmail;
        }
        int open = fromAddress.lastIndexOf('<');
        int close = fromAddress.lastIndexOf('>');
        if (open >= 0 && close > open) {
            return fromAddress.substring(open + 1, close).trim();
        }
        return fromAddress.trim();
    }

    /** The display name, parsed out of fromAddress when that form is used. */
    public String senderName() {
        if (fromAddress == null || fromAddress.isBlank()) {
            return fromName;
        }
        int open = fromAddress.lastIndexOf('<');
        if (open > 0) {
            return fromAddress.substring(0, open).trim().replaceAll("^\"|\"$", "");
        }
        return fromName;
    }

    public enum Provider {
        RESEND,
        SMTP,
        LOG
    }
}
