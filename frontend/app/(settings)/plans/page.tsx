import type { Metadata } from "next";
import { CandidatePlansView } from "@/components/plan/CandidatePlansView";
import { RecruiterPlansPreview } from "@/components/plan/RecruiterPlansPreview";
import { requireSession } from "@/lib/auth/session";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.plans.title };
}

/**
 * One `/plans` route, two products.
 *
 * ## Why it moved out of the candidate group
 *
 * Next.js route groups cannot both claim `/plans`, and both sides need it.
 * This sits in the shared authenticated group — the same one `/settings`
 * already uses to serve both account types — and branches on the account
 * type the session states.
 *
 * ## The two branches are not variations of one page
 *
 * The job seeker's plans are a LIVE billing surface: real entitlements, a
 * real Toss checkout, a real current-plan reading. The recruiter's are a
 * roadmap: nothing is purchasable, nothing is entitled, and no billing call
 * is made. Sharing a component between them is how a preview accidentally
 * grows a checkout button, so they share only the visual language.
 */
export default async function PlansPage() {
  const session = await requireSession();

  if (session.accountType === "CANDIDATE") {
    // Unchanged behaviour: this view still authorizes itself against the
    // personal workspace and reads live billing.
    return <CandidatePlansView />;
  }

  return <RecruiterPlansPreview />;
}
