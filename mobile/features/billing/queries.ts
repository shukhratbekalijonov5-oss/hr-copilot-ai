import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { apiFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/query/keys";
import type { BillingState, CandidatePlan, CheckoutSession } from "@/types";

/**
 * Billing, read from the server and changed only by the server.
 *
 * ## The device is never the authority on what somebody paid for
 *
 * `useBilling` is the single source of plan truth on mobile, and it is a
 * server read. Nothing is cached to disk, nothing is inferred from a
 * successful browser return, and a completed payment changes the UI only
 * after this query has been refetched and the SERVER has said the plan
 * moved. A checkout that appears to succeed and a subscription that actually
 * activated are different events, and only the backend knows the second one.
 */
export function useBilling() {
  return useQuery({
    queryKey: queryKeys.billing.summary,
    queryFn: () => apiFetch<BillingState>("/candidate-account/me/billing"),
  });
}

/**
 * Only these two are purchasable. FREE is what you have without paying, so
 * "checkout FREE" is not a downgrade path — `/downgrade` is.
 */
export type CheckoutPlan = Extract<CandidatePlan, "PRO" | "MAX">;

/**
 * Refuses anything that is not an ordinary web URL.
 *
 * A checkout response is opened in a browser, so a malformed or hostile
 * `redirectUrl` would be a way to make the app launch something else —
 * `javascript:`, a deep link into another app, a file path. The backend is
 * trusted, but a client that opens whatever it is handed has no defence if
 * that assumption ever stops holding, and the check costs one comparison.
 */
export function isNavigableCheckoutUrl(url: string): boolean {
  return /^https:\/\/[^\s]+$/i.test(url);
}

/**
 * Starts a checkout and hands the reader to the hosted Toss page.
 *
 * ## The whole payment happens outside this app
 *
 * mobile → backend creates the checkout → hosted URL opens in the system
 * browser → the reader pays there → the app comes back and REFETCHES.
 *
 * No card number, expiry or CVC is ever typed into, held by, or sent from
 * this app, and no Toss key of any kind is bundled with it. That is not a
 * simplification: handling raw card details on the device would drag the
 * whole app into PCI scope for no product gain.
 */
export function useCheckout() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (plan: CheckoutPlan) => {
      const session = await apiFetch<CheckoutSession>(
        "/candidate-account/me/billing/checkout",
        { method: "POST", body: { plan } },
      );

      if (!session?.redirectUrl || !isNavigableCheckoutUrl(session.redirectUrl)) {
        throw new ApiError(
          "Checkout returned an unreadable response.",
          502,
          "server",
        );
      }

      /*
       * `openAuthSessionAsync` rather than `openBrowserAsync`: it returns
       * control when the flow finishes or the reader dismisses it, so there
       * is a definite moment to refetch. It resolves with "dismiss" or
       * "cancel" — neither of which means the payment failed, and neither of
       * which is treated as proof it succeeded.
       */
      const result = await WebBrowser.openAuthSessionAsync(session.redirectUrl);
      return { session, result };
    },

    // Whatever the browser reported, ask the server what is true now.
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.billing.summary });
      void client.invalidateQueries({ queryKey: queryKeys.session });
    },
  });
}

/** Cancels at period end. Paid access runs to `effectiveUntil`. */
export function useCancelSubscription() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiFetch<BillingState>("/candidate-account/me/billing/cancel", {
        method: "POST",
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.billing.summary });
    },
  });
}
