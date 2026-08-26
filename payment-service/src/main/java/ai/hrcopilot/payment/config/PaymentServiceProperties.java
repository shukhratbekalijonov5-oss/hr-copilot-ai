package ai.hrcopilot.payment.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Service configuration. Every secret arrives from the environment; nothing
 * here has a baked-in credential, and blank values fail CLOSED (internal
 * endpoints reject everything, webhooks verify nothing).
 *
 * @param internalToken     shared service-to-service credential for /internal/**
 * @param provider          selected payment provider. Production refuses MOCK.
 * @param mockWebhookSecret HMAC secret for the sandbox provider's webhooks
 * @param outboxPollMs      publisher poll interval
 * @param outboxBatchSize   events attempted per poll
 * @param publishEnabled    master switch for the Kafka publisher loop
 * @param portfolioDemoMode EXPLICIT portfolio-demo gate: re-enables the
 *                          plan-switch endpoint on a demo deployment.
 *                          Nothing else in the service reads it.
 */
@ConfigurationProperties(prefix = "payment")
public record PaymentServiceProperties(
        String internalToken,
        Provider provider,
        String mockWebhookSecret,
        long outboxPollMs,
        int outboxBatchSize,
        boolean publishEnabled,
        boolean portfolioDemoMode) {

    public PaymentServiceProperties {
        if (provider == null) {
            provider = Provider.MOCK;
        }
        if (outboxPollMs <= 0) {
            outboxPollMs = 2_000;
        }
        if (outboxBatchSize <= 0) {
            outboxBatchSize = 50;
        }
    }

    public enum Provider {
        MOCK,
        TOSS
    }
}
