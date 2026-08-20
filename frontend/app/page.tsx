import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { defaultRouteForAccountType } from "@/lib/auth/routing";

/**
 * Where a signed-in person lands.
 *
 * One rule, applied from the live session rather than guessed at each call
 * site: a token with an active organization opens the recruiting dashboard, a
 * user with memberships but no active one picks a workspace, and everyone else
 * — a job seeker — opens the job board. A candidate-only account is never sent
 * to an organization route it cannot load.
 */
export default async function Home() {
  const session = await requireSession();

  redirect(
    defaultRouteForAccountType(
      session.accountType,
      Boolean(session.activeOrganization),
    ),
  );
}
