package ai.hrcopilot.payment.api;

import ai.hrcopilot.payment.config.PaymentServiceProperties;
import ai.hrcopilot.payment.domain.Plan;
import ai.hrcopilot.payment.service.PlanSwitchService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Direct plan switch — available in exactly two situations:
 *
 *  1. dev/test profiles (the original QA switch), or
 *  2. {@code PORTFOLIO_DEMO_MODE=true} — an EXPLICIT, narrow gate for demo
 *     deployments that must showcase paid tiers without a real charge.
 *
 * Anywhere else the endpoint answers a plain 404, byte-shaped like a route
 * that never existed. The gate re-enables ONLY this endpoint: MOCK-provider
 * refusal, webhook rules and every other production behavior are untouched.
 * Callers still authenticate with the internal service token (/internal/**
 * filter), and the ONLY identity honored is the one the authenticated BFF
 * resolved from the caller's own session — the BFF never forwards a
 * browser-supplied userId.
 *
 * Every demo switch writes the standard audit row + entitlement event with
 * source PORTFOLIO_DEMO, so demo activity is always distinguishable from
 * real billing.
 */
@RestController
public class DevPlanSwitchController {

    private static final Logger log = LoggerFactory.getLogger(DevPlanSwitchController.class);

    public record PlanSwitchRequest(@NotBlank String userId, @NotNull Plan plan) {
    }

    public record PlanSwitchResponse(String userId, String plan, boolean changed) {
    }

    private final PlanSwitchService planSwitch;
    private final boolean devOrTest;
    private final boolean portfolioDemo;

    public DevPlanSwitchController(
            PlanSwitchService planSwitch,
            PaymentServiceProperties properties,
            Environment environment) {
        this.planSwitch = planSwitch;
        this.devOrTest = environment.matchesProfiles("dev", "test");
        this.portfolioDemo = properties.portfolioDemoMode();
        if (this.portfolioDemo && !this.devOrTest) {
            // Loud, secret-free startup marker: operators must always know a
            // deployment can switch plans without payment.
            log.warn("PORTFOLIO DEMO MODE ENABLED: /internal/dev/plan-switch is active on this deployment");
        }
    }

    @PostMapping("/internal/dev/plan-switch")
    public PlanSwitchResponse switchPlan(@Valid @RequestBody PlanSwitchRequest request) {
        if (!devOrTest && !portfolioDemo) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        String actor = devOrTest ? "dev-plan-switch" : "PORTFOLIO_DEMO";
        PlanSwitchService.SwitchResult result =
                planSwitch.switchPlan(request.userId(), request.plan(), actor);
        return new PlanSwitchResponse(request.userId(), result.plan().name(), result.changed());
    }
}
