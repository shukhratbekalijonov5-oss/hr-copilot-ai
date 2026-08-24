package ai.hrcopilot.payment.api;

import ai.hrcopilot.payment.domain.Capability;
import ai.hrcopilot.payment.service.EntitlementService;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * The internal entitlement contract the NestJS backend consumes:
 *
 *   GET /internal/entitlements/{userId}
 *
 * Service-authenticated (InternalAuthFilter), read-only, synchronous HTTP —
 * deliberately NOT Kafka: an authorization check needs an answer now, and a
 * request/reply detour through a log would add latency and a second
 * source-of-truth. Kafka carries change NOTIFICATIONS; this endpoint
 * carries truth.
 */
@RestController
public class EntitlementController {

    public record EntitlementResponse(
            String userId,
            String plan,
            List<String> capabilities,
            String subscriptionStatus,
            String effectiveUntil,
            long version) {
    }

    private final EntitlementService entitlements;

    public EntitlementController(EntitlementService entitlements) {
        this.entitlements = entitlements;
    }

    @GetMapping("/internal/entitlements/{userId}")
    public EntitlementResponse entitlements(@PathVariable String userId) {
        EntitlementService.Entitlements resolved = entitlements.entitlementsFor(userId);
        return new EntitlementResponse(
                resolved.userId(),
                resolved.plan().name(),
                resolved.capabilities().stream().map(Capability::name).toList(),
                resolved.subscriptionStatus(),
                resolved.effectiveUntil() == null ? null : resolved.effectiveUntil().toString(),
                resolved.version());
    }
}
