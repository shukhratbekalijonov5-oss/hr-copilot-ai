package ai.hrcopilot.payment.api;

import ai.hrcopilot.payment.provider.toss.TossProperties;
import ai.hrcopilot.payment.service.PaymentConfirmationService;
import java.net.URI;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Toss redirect/confirmation endpoints.
 *
 * ## Trust model
 *
 * The redirect query (`paymentKey`, `orderId`, `amount`) is a BROWSER value
 * and therefore a hint, never truth: the confirmation service checks order
 * and amount against the local pending payment, then asks Toss itself over
 * the authenticated confirm API, and only the authenticated answer can
 * activate anything. A tampered or fabricated callback ends at one of those
 * checks and grants nothing.
 *
 * ## Browser endpoints answer with redirects, not JSON
 *
 * The two /callbacks routes are what a HUMAN lands on. Success and every
 * failure mode alike end in a 302 to a FIXED, configured frontend target
 * (TossProperties.browserSuccessUrl/browserFailUrl) — no exception text, no
 * provider detail, and no caller-influenced URL ever reaches the Location
 * header. `/internal/toss/confirm` stays JSON for service callers and sits
 * behind InternalAuthFilter like every /internal route.
 */
@RestController
public class TossCallbackController {

    private static final Logger log = LoggerFactory.getLogger(TossCallbackController.class);

    private final PaymentConfirmationService confirmation;
    private final TossProperties toss;

    public TossCallbackController(PaymentConfirmationService confirmation, TossProperties toss) {
        this.confirmation = confirmation;
        this.toss = toss;
    }

    @GetMapping("/callbacks/toss/success")
    public ResponseEntity<Void> success(
            @RequestParam String paymentKey,
            @RequestParam String orderId,
            @RequestParam String amount) {
        try {
            confirmation.confirm(paymentKey, orderId, amount);
            return redirect(toss.browserSuccessUrl());
        } catch (RuntimeException notConfirmable) {
            // Verification failed (tampered params, amount mismatch, foreign
            // paymentKey, provider refusal, ...). The class name is logged
            // for operators; the browser gets only the fixed fail target
            // with a stable reason code.
            log.warn("Toss success callback did not confirm: {}",
                    notConfirmable.getClass().getSimpleName());
            return redirect(withReason(toss.browserFailUrl(), "confirmation_failed"));
        }
    }

    @GetMapping("/callbacks/toss/fail")
    public ResponseEntity<Void> fail() {
        // Toss appends code/message/orderId here; none of it is needed —
        // the payment stays PENDING locally and expires provider-side.
        return redirect(withReason(toss.browserFailUrl(), "payment_failed"));
    }

    @PostMapping("/internal/toss/confirm")
    public Map<String, Object> confirm(@RequestBody ConfirmRequest request) {
        PaymentConfirmationService.Outcome outcome =
                confirmation.confirm(request.paymentKey(), request.orderId(), request.amount());
        return Map.of("outcome", outcome.name(), "duplicate", outcome == PaymentConfirmationService.Outcome.DUPLICATE);
    }

    private static ResponseEntity<Void> redirect(String target) {
        return ResponseEntity.status(302).location(URI.create(target)).build();
    }

    private static String withReason(String target, String reason) {
        return target + (target.contains("?") ? "&" : "?") + "reason=" + reason;
    }

    public record ConfirmRequest(String paymentKey, String orderId, String amount) {
    }
}
