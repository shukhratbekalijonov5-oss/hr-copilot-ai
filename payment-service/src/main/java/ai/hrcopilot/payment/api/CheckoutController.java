package ai.hrcopilot.payment.api;

import ai.hrcopilot.payment.domain.Plan;
import ai.hrcopilot.payment.service.CheckoutService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * Checkout creation (foundation — the sandbox provider answers it today).
 *
 * `Idempotency-Key` is REQUIRED: a retried request with the same key gets
 * the same order back, which is the entire defense against double charges
 * at this boundary.
 */
@RestController
public class CheckoutController {

    public record CheckoutRequest(@NotBlank String userId, @NotNull Plan plan) {
    }

    public record CheckoutResponse(String paymentId, String checkoutId, String redirectUrl, boolean reused) {
    }

    private final CheckoutService checkout;

    public CheckoutController(CheckoutService checkout) {
        this.checkout = checkout;
    }

    @PostMapping("/internal/checkout")
    public CheckoutResponse create(
            @RequestHeader("Idempotency-Key") @NotBlank String idempotencyKey,
            @Valid @RequestBody CheckoutRequest request) {
        CheckoutService.CheckoutResult result =
                checkout.createCheckout(request.userId(), request.plan(), idempotencyKey);
        return new CheckoutResponse(
                result.paymentId(), result.checkoutId(), result.redirectUrl(), result.reused());
    }
}
