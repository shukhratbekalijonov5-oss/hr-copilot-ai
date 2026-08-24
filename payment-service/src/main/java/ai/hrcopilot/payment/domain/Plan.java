package ai.hrcopilot.payment.domain;

import java.util.Optional;

/**
 * The three candidate plans. The names are a cross-service contract with the
 * NestJS policy table (candidate-plan.policy.ts) and must not drift.
 *
 * Persistence stores plans as strings and re-enters the domain ONLY through
 * {@link #parse}, so a value this deployment does not know (a future tier,
 * or corruption) becomes an empty Optional — which every caller treats as
 * "grants nothing" — rather than an exception half-way through a request.
 */
public enum Plan {
    FREE(0, 0),
    PRO(700, 9_900),
    MAX(1200, 16_900);

    /** Monthly price in USD cents. FREE = $0, PRO = $7, MAX = $12. */
    private final int monthlyPriceCents;

    /**
     * Fixed KRW charge when checkout runs through a KRW-only method (Toss
     * CARD). This is a PRICE decision, not FX: the product is displayed as
     * USD and charged as this fixed won amount. KRW has no minor unit, so
     * the value is whole won.
     */
    private final int monthlyPriceKrw;

    Plan(int monthlyPriceCents, int monthlyPriceKrw) {
        this.monthlyPriceCents = monthlyPriceCents;
        this.monthlyPriceKrw = monthlyPriceKrw;
    }

    public int monthlyPriceCents() {
        return monthlyPriceCents;
    }

    public int monthlyPriceKrw() {
        return monthlyPriceKrw;
    }

    public static Optional<Plan> parse(String raw) {
        if (raw == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(Plan.valueOf(raw));
        } catch (IllegalArgumentException unknown) {
            return Optional.empty();
        }
    }
}
