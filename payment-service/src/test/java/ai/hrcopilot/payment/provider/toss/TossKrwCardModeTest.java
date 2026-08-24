package ai.hrcopilot.payment.provider.toss;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ai.hrcopilot.payment.domain.Plan;
import ai.hrcopilot.payment.provider.PaymentProvider;
import java.math.BigDecimal;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The KRW card mode: fixed won amounts (a pricing decision, never FX),
 * zero-decimal handling, and the request bodies Toss actually receives.
 */
class TossKrwCardModeTest {

    private static TossProperties props(String method) {
        return new TossProperties(
                "https://toss.test",
                "test_ck_x",
                "test_sk_x",
                "https://merchant.example/callbacks/toss/success",
                "https://merchant.example/callbacks/toss/fail",
                "https://frontend.example/plans?checkout=success",
                "https://frontend.example/plans",
                method,
                "PAYPAL",
                1000,
                1000);
    }

    @Test
    void krwIsZeroDecimalAndUsdKeepsCents() {
        assertThat(TossClient.minorToTossAmount(9_900, "KRW")).isEqualByComparingTo("9900");
        assertThat(TossClient.minorToTossAmount(700, "USD")).isEqualByComparingTo("7");
        assertThat(TossClient.tossAmountToMinor(new BigDecimal("16900"), "KRW")).isEqualTo(16_900);
        assertThat(TossClient.tossAmountToMinor(new BigDecimal("12"), "USD")).isEqualTo(1_200);
    }

    @Test
    void cardModeChargesTheFixedWonAmounts() {
        TossPaymentProvider provider = new TossPaymentProvider(new TossClient(props("CARD")), props("CARD"));
        assertThat(provider.checkoutPrice(Plan.PRO))
                .isEqualTo(new PaymentProvider.Price(9_900, "KRW"));
        assertThat(provider.checkoutPrice(Plan.MAX))
                .isEqualTo(new PaymentProvider.Price(16_900, "KRW"));
    }

    @Test
    void foreignEasyPayModeStillChargesUsdProductPrice() {
        TossPaymentProvider provider = new TossPaymentProvider(
                new TossClient(props("FOREIGN_EASY_PAY")), props("FOREIGN_EASY_PAY"));
        assertThat(provider.checkoutPrice(Plan.PRO))
                .isEqualTo(new PaymentProvider.Price(700, "USD"));
        assertThat(provider.checkoutPrice(Plan.MAX))
                .isEqualTo(new PaymentProvider.Price(1_200, "USD"));
    }

    @Test
    void cardModeRefusesANonKrwCheckout() {
        TossPaymentProvider provider = new TossPaymentProvider(new TossClient(props("CARD")), props("CARD"));
        assertThatThrownBy(() -> provider.createCheckout(new PaymentProvider.CheckoutRequest(
                "user-1", Plan.PRO, 700, "USD", "hrc_x", "order", "key")))
                .isInstanceOf(TossProviderException.class);
    }

    @Test
    void cardCreateBodyIsKrwWithoutTheEasyPayProviderField() {
        Map<String, Object> body = new TossClient.TossCreatePaymentRequest(
                "hrc_order", "HR Copilot PRO monthly plan", 9_900, "KRW",
                "https://merchant.example/s", "https://merchant.example/f")
                .toBody(props("CARD"));
        assertThat(body.get("method")).isEqualTo("CARD");
        assertThat(body.get("currency")).isEqualTo("KRW");
        assertThat((BigDecimal) body.get("amount")).isEqualByComparingTo("9900");
        assertThat(body).doesNotContainKey("provider");
    }

    @Test
    void confirmBodySendsWholeWon() {
        Map<String, Object> body = new TossClient.TossConfirmPaymentRequest(
                "pay_key", "hrc_order", 16_900, "KRW").toBody();
        assertThat((BigDecimal) body.get("amount")).isEqualByComparingTo("16900");
    }

    @Test
    void validateForUseAcceptsCardAndBothLegacyModes() {
        props("CARD").validateForUse();
        props("FOREIGN_EASY_PAY").validateForUse();
        assertThatThrownBy(() -> props("VIRTUAL_ACCOUNT").validateForUse())
                .isInstanceOf(IllegalStateException.class);
    }
}
