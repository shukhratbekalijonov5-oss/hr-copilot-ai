package ai.hrcopilot.payment;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ai.hrcopilot.payment.config.PaymentProviderConfiguration;
import ai.hrcopilot.payment.config.PaymentServiceProperties;
import ai.hrcopilot.payment.provider.toss.TossProperties;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class PaymentProviderSelectionTest {

    @Test
    void productionDoesNotSilentlyFallbackToMock() {
        // BOTH common production profile spellings refuse MOCK — the check
        // must not be dodgeable by profile naming.
        for (String profile : new String[] {"production", "prod"}) {
            PaymentProviderConfiguration configuration = new PaymentProviderConfiguration();
            PaymentServiceProperties properties = new PaymentServiceProperties(
                    "token",
                    PaymentServiceProperties.Provider.MOCK,
                    "secret",
                    2000,
                    50,
                    false);
            MockEnvironment env = new MockEnvironment();
            env.setActiveProfiles(profile);

            assertThatThrownBy(() -> configuration.paymentProvider(properties, emptyToss(), env))
                    .as("profile " + profile)
                    .hasMessageContaining("MOCK is not allowed");
        }
    }

    @Test
    void tossMissingSecretFailsClosed() {
        assertThatThrownBy(emptyToss()::validateForUse)
                .hasMessageContaining("TOSS_PAYMENTS_CLIENT_KEY");
    }

    private TossProperties emptyToss() {
        return new TossProperties("", "", "", "", "", "", "", "", "", 0, 0);
    }
}
