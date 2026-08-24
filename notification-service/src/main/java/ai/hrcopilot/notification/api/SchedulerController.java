package ai.hrcopilot.notification.api;

import ai.hrcopilot.notification.service.ExpiryReminderScheduler;
import java.util.Map;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Operational trigger for the expiry-reminder pass — the same idempotent
 * code path the timer runs, so invoking it never risks duplicates (the
 * database constraint decides, not the caller's discipline). Internal-only.
 */
@RestController
public class SchedulerController {

    private final ExpiryReminderScheduler scheduler;

    public SchedulerController(ExpiryReminderScheduler scheduler) {
        this.scheduler = scheduler;
    }

    @PostMapping("/internal/schedulers/expiry/run")
    public Map<String, Object> run() {
        return Map.of("recorded", scheduler.runOnce());
    }
}
