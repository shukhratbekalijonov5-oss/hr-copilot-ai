import { CandidatePageHeader } from "@/components/candidate/ui";
import { PlansWorkspace } from "@/components/plan/PlansWorkspace";
import { api, ApiError, toApiError } from "@/lib/api";
import type { BillingSummary } from "@/lib/billing/types";
import { getTranslations } from "@/lib/i18n/server";
import { requirePersonalWorkspace } from "@/lib/workspace/server";

/**
 * What the three plans include.
 *
 * ## Deliberately small billing surface
 *
 * Paid upgrades start a backend checkout and then leave for the provider URL
 * the backend returns. The browser never talks to a payment service directly,
 * never constructs a provider URL, and never marks the plan changed here.
 *
 * Current plan and feature access still come only from the session returned by
 * the backend. A successful checkout has to show up in billing/auth reads
 * before the UI treats it as real.
 *
 * ## The current plan is marked only when the backend says so
 *
 * On an API that does not report plans, nothing is marked current — rather
 * than marking Free, which would tell a paying customer they are on the free
 * tier. Absence of information is shown as absence of information.
 *
 * ## It authorizes itself
 *
 * `requirePersonalWorkspace()` is called here rather than inherited from a
 * layout, because `/plans` is now a shared route that org accounts also
 * reach. A job seeker's billing surface must never render for one.
 */
export async function CandidatePlansView() {
  const [{ workspace }, d, billing] = await Promise.all([
    requirePersonalWorkspace(),
    getTranslations(),
    loadBillingSummary(),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <CandidatePageHeader
        eyebrow={d.nav.sectionAccount}
        title={d.plans.title}
        description={d.plans.description}
      />
      <PlansWorkspace
        initialEntitlements={workspace.entitlements}
        initialBilling={billing.summary}
        initialBillingError={billing.error}
        showDeveloperPlanSwitch={process.env.NODE_ENV !== "production"}
      />
    </div>
  );
}

type BillingLoad =
  | { summary: BillingSummary; error: null }
  | { summary: null; error: "billingUnavailable" | "unauthenticated" | "forbidden" };

async function loadBillingSummary(): Promise<BillingLoad> {
  try {
    return { summary: await api.getBillingSummary(), error: null };
  } catch (error) {
    const apiError = error instanceof ApiError ? error : toApiError(error);
    if (apiError.status === 401) {
      return { summary: null, error: "unauthenticated" };
    }
    if (apiError.status === 403) {
      return { summary: null, error: "forbidden" };
    }
    return { summary: null, error: "billingUnavailable" };
  }
}
