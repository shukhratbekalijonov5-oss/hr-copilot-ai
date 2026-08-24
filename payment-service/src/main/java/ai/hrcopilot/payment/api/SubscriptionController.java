package ai.hrcopilot.payment.api;

import ai.hrcopilot.payment.domain.Plan;
import ai.hrcopilot.payment.domain.entity.Subscription;
import ai.hrcopilot.payment.repository.SubscriptionRepository;
import ai.hrcopilot.payment.service.SubscriptionService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Voluntary subscription changes: scheduled downgrade, end-of-period cancel. */
@RestController
public class SubscriptionController {

    public record DowngradeRequest(@NotNull Plan plan) {
    }

    private final SubscriptionService subscriptions;
    private final SubscriptionRepository subscriptionRows;

    public SubscriptionController(
            SubscriptionService subscriptions, SubscriptionRepository subscriptionRows) {
        this.subscriptions = subscriptions;
        this.subscriptionRows = subscriptionRows;
    }

    public record ExpiringSubscription(
            String userId, String subscriptionId, String plan, String currentPeriodEnd) {
    }

    /**
     * Paid subscriptions whose period ends within `withinDays` — consumed by
     * the Notification Service's expiry-reminder scheduler. Read-only;
     * billing truth never leaves this service, only who is due and when.
     */
    @GetMapping("/internal/subscriptions/expiring")
    public Map<String, Object> expiring(
            @RequestParam(name = "withinDays", defaultValue = "3") int withinDays) {
        int bounded = Math.max(1, Math.min(withinDays, 30));
        Instant now = Instant.now();
        List<ExpiringSubscription> due = subscriptionRows
                .findExpiringPaid(now, now.plus(bounded, ChronoUnit.DAYS))
                .stream()
                .map(row -> {
                    Subscription subscription = (Subscription) row[0];
                    return new ExpiringSubscription(
                            (String) row[1],
                            subscription.getId().toString(),
                            subscription.getCurrentPlanRaw(),
                            subscription.getCurrentPeriodEnd().toString());
                })
                .toList();
        return Map.of("withinDays", bounded, "subscriptions", due);
    }

    @PostMapping("/internal/subscriptions/{userId}/downgrade")
    public Map<String, Object> downgrade(
            @PathVariable @NotBlank String userId, @Valid @RequestBody DowngradeRequest request) {
        subscriptions.scheduleDowngrade(userId, request.plan());
        return Map.of("userId", userId, "pendingPlan", request.plan().name());
    }

    @PostMapping("/internal/subscriptions/{userId}/cancel")
    public Map<String, Object> cancel(@PathVariable @NotBlank String userId) {
        subscriptions.cancelAtPeriodEnd(userId);
        return Map.of("userId", userId, "cancelAtPeriodEnd", true);
    }
}
