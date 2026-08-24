package ai.hrcopilot.payment.domain;

/**
 * Candidate capabilities, mirrored name-for-name from the NestJS policy
 * table. NestJS remains the ENFORCEMENT boundary; this service publishes
 * the list so callers need not duplicate the mapping, but a divergence is a
 * bug in one of the two tables, never something enforcement silently trusts.
 */
public enum Capability {
    INTERNAL_AI_SEARCH,
    EXTERNAL_AI_SEARCH
}
