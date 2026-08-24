package ai.hrcopilot.payment.api;

import ai.hrcopilot.payment.provider.PaymentProvider;
import ai.hrcopilot.payment.provider.ProviderEvent;
import ai.hrcopilot.payment.service.WebhookProcessingService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Provider webhook intake.
 *
 * NOT under /internal — a PSP cannot present our service token. The
 * authentication here is the provider's own signature, verified BEFORE the
 * body is parsed or acted on; an unverifiable delivery is a 401 and touches
 * nothing. Today the only provider is the sandbox (MOCK); a real provider
 * plugs in behind the same interface without this controller changing.
 */
@RestController
public class WebhookController {

    private final PaymentProvider provider;
    private final WebhookProcessingService processing;

    public WebhookController(PaymentProvider provider, WebhookProcessingService processing) {
        this.provider = provider;
        this.processing = processing;
    }

    @PostMapping({"/webhooks/mock", "/webhooks/toss"})
    public ResponseEntity<Map<String, Object>> receive(
            HttpServletRequest request, @RequestBody String rawBody) {
        Map<String, String> headers = headersOf(request);
        if (!provider.verifyWebhookSignature(headers, rawBody)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "invalid signature"));
        }
        Optional<ProviderEvent> event = provider.parseEvent(rawBody);
        if (event.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "unparseable event"));
        }
        WebhookProcessingService.Outcome outcome =
                processing.process(provider.name(), event.get(), rawBody);
        return ResponseEntity.ok(Map.of(
                "outcome", outcome.name(),
                "duplicate", outcome == WebhookProcessingService.Outcome.DUPLICATE));
    }

    private Map<String, String> headersOf(HttpServletRequest request) {
        Map<String, String> headers = new HashMap<>();
        for (String name : Collections.list(request.getHeaderNames())) {
            headers.put(name.toLowerCase(Locale.ROOT), request.getHeader(name));
        }
        return headers;
    }
}
