package ai.hrcopilot.payment.domain;

import java.util.List;
import java.util.Map;

/**
 * THE plan→capability mapping, identical to candidate-plan.policy.ts:
 *
 *   FREE → []
 *   PRO  → [INTERNAL_AI_SEARCH]
 *   MAX  → [INTERNAL_AI_SEARCH, EXTERNAL_AI_SEARCH]
 *
 * One table, declared once. There is deliberately no code path that grants
 * a capability off-table, and an unknown plan never reaches this map (see
 * Plan.parse — it fails closed before this point).
 */
public final class PlanCapabilities {

    private static final Map<Plan, List<Capability>> GRANTS = Map.of(
            Plan.FREE, List.of(),
            Plan.PRO, List.of(Capability.INTERNAL_AI_SEARCH),
            Plan.MAX, List.of(Capability.INTERNAL_AI_SEARCH, Capability.EXTERNAL_AI_SEARCH));

    private PlanCapabilities() {
    }

    public static List<Capability> grantedBy(Plan plan) {
        return GRANTS.get(plan);
    }
}
