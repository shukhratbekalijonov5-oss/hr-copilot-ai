/**
 * The recruiter plan preview, as data.
 *
 * ## This is a roadmap, not a price list
 *
 * Nothing here is purchasable, no tier maps to an entitlement, and no value
 * is read from or written to the payment service. `availability` is the whole
 * point of the shape: FREE describes what a recruiter can do TODAY, and the
 * other two describe intent. A component cannot render one as the other,
 * because the badge and the disabled action both read this field.
 *
 * ## Price is deliberately not a number
 *
 * There is no approved recruiter pricing, so PRO and MAX carry no amount at
 * all rather than a plausible one. Copying the job seeker's $7/$12 across
 * would be inventing a commercial decision nobody has made.
 */
export type RecruiterTierId = "FREE" | "PRO" | "MAX";

export type TierAvailability = "available" | "planned";

export interface RecruiterTier {
  id: RecruiterTierId;
  availability: TierAvailability;
  /** `null` means "no price exists yet" — never render it as zero. */
  monthlyUsd: number | null;
  /** MAX carries the strongest treatment; FREE stays neutral. */
  emphasis: "none" | "accent" | "strong";
}

export const RECRUITER_TIERS: readonly RecruiterTier[] = [
  { id: "FREE", availability: "available", monthlyUsd: 0, emphasis: "none" },
  { id: "PRO", availability: "planned", monthlyUsd: null, emphasis: "accent" },
  { id: "MAX", availability: "planned", monthlyUsd: null, emphasis: "strong" },
];

/**
 * Sources the planned sourcing feature INTENDS to search.
 *
 * Every one is unconnected. The type has no "connected" state on purpose:
 * there is no way to express "integrated" here, so a future edit cannot
 * casually promote a chip to a claim the product cannot keep. Names are
 * plain text — no logos, which would imply a partnership that does not
 * exist and would need licensing we do not have.
 */
export const PLANNED_SOURCING_SOURCES = [
  "LinkedIn",
  "Saramin",
  "JobKorea",
] as const;

export type PlannedSourcingSource = (typeof PLANNED_SOURCING_SOURCES)[number];
