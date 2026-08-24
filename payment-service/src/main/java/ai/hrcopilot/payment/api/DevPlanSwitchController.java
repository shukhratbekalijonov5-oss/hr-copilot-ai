package ai.hrcopilot.payment.api;

import ai.hrcopilot.payment.domain.Plan;
import ai.hrcopilot.payment.service.PlanSwitchService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * DEV/TEST ONLY: set a user's plan directly.
 *
 * The protection is structural, not conditional: `@Profile({"dev","test"})`
 * means this BEAN DOES NOT EXIST in a production context — there is no
 * controller to guard, no route to 403, no flag to misconfigure. A request
 * to this path in production is an ordinary 404 for a route that was never
 * registered. On top of that absence, dev/test callers still present the
 * internal service token like every other /internal route.
 *
 * Production plan changes happen exactly one way: a verified provider
 * webhook activating a paid subscription.
 */
@RestController
@Profile({"dev", "test"})
public class DevPlanSwitchController {

    public record PlanSwitchRequest(@NotBlank String userId, @NotNull Plan plan) {
    }

    public record PlanSwitchResponse(String userId, String plan, boolean changed) {
    }

    private final PlanSwitchService planSwitch;

    public DevPlanSwitchController(PlanSwitchService planSwitch) {
        this.planSwitch = planSwitch;
    }

    @PostMapping("/internal/dev/plan-switch")
    public PlanSwitchResponse switchPlan(@Valid @RequestBody PlanSwitchRequest request) {
        PlanSwitchService.SwitchResult result =
                planSwitch.switchPlan(request.userId(), request.plan(), "dev-plan-switch");
        return new PlanSwitchResponse(request.userId(), result.plan().name(), result.changed());
    }
}
