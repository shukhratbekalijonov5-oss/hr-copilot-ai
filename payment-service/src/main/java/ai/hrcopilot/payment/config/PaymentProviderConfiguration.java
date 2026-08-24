package ai.hrcopilot.payment.config;

import ai.hrcopilot.payment.provider.MockPaymentProvider;
import ai.hrcopilot.payment.provider.PaymentProvider;
import ai.hrcopilot.payment.provider.toss.TossClient;
import ai.hrcopilot.payment.provider.toss.TossPaymentProvider;
import ai.hrcopilot.payment.provider.toss.TossProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/**
 * Exactly one payment provider is active. Local/test default to MOCK; a
 * production boot with MOCK is refused so a real deployment cannot silently
 * run on the sandbox implementation.
 */
@Configuration
public class PaymentProviderConfiguration {

    @Bean
    public PaymentProvider paymentProvider(
            PaymentServiceProperties payment,
            TossProperties toss,
            Environment environment) {
        if (payment.provider() == PaymentServiceProperties.Provider.MOCK) {
            // Both common production profile spellings are refused — a
            // deployment must not dodge this check by profile naming.
            if (environment.matchesProfiles("prod", "production")) {
                throw new IllegalStateException("PAYMENT_PROVIDER=MOCK is not allowed in production");
            }
            return new MockPaymentProvider(payment);
        }
        toss.validateForUse();
        return new TossPaymentProvider(new TossClient(toss), toss);
    }
}
