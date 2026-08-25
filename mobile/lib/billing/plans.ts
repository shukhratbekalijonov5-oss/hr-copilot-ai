/**
 * Plan presentation data.
 *
 * ## Candidate pricing is real; recruiter pricing does not exist
 *
 * The candidate tiers carry the product's live prices and the fixed KRW
 * amounts Toss charges — display copy mirroring the server-authoritative
 * figures, never a value this app computes. The recruiter tiers carry no
 * price at all: there is no approved recruiter pricing, and copying $7/$12
 * across would invent a commercial decision nobody has made.
 *
 * ## No payment logic lives on the device
 *
 * Nothing here calculates, charges or stores anything. A purchase is a
 * backend-created checkout URL opened in a browser; the app never sees a
 * card, a token or a secret.
 */
export interface CandidateTier {
  id: "FREE" | "PRO" | "MAX";
  monthlyUsd: number;
  /** Pre-formatted KRW string, mirroring the payment service's fixed price. */
  krw: string | null;
}

export const CANDIDATE_TIERS: readonly CandidateTier[] = [
  { id: "FREE", monthlyUsd: 0, krw: null },
  { id: "PRO", monthlyUsd: 7, krw: "9,900" },
  { id: "MAX", monthlyUsd: 12, krw: "16,900" },
];

export interface RecruiterTier {
  id: "FREE" | "PRO" | "MAX";
  availability: "available" | "planned";
  /** `null` means no price exists yet — never render it as zero. */
  monthlyUsd: number | null;
}

export const RECRUITER_TIERS: readonly RecruiterTier[] = [
  { id: "FREE", availability: "available", monthlyUsd: 0 },
  { id: "PRO", availability: "planned", monthlyUsd: null },
  { id: "MAX", availability: "planned", monthlyUsd: null },
];

/**
 * Sources the PLANNED recruiter sourcing feature intends to search.
 *
 * None is connected. The type carries no "connected" state at all, so a
 * future edit cannot quietly promote a chip into a claim the product cannot
 * keep. Plain text only — a logo would imply a partnership that does not
 * exist and would need licensing we do not have.
 */
export const PLANNED_SOURCES = ["LinkedIn", "Saramin", "JobKorea"] as const;
