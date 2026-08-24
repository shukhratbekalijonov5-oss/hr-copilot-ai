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
 * @param emailProvider     SMTP (real sending) or LOG (local fallback; refused in prod)
 * @param fromEmail         From address for every product email
 * @param fromName          From display name
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
        String fromEmail,
        String fromName,
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

    public enum Provider {
        SMTP,
        LOG
    }
}
