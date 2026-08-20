import { AppShell } from "@/components/layout/AppShell";
import { JobMatchStateProvider } from "@/components/candidate/JobMatchStateProvider";
import { jobMatchCacheKey } from "@/lib/candidate/job-match-cache-key";
import { getLocale } from "@/lib/i18n/server";
import { requirePersonalWorkspace } from "@/lib/workspace/server";

/**
 * The job-seeker side of the product.
 *
 * It shares the shell with the recruiting workspace but gets its own
 * navigation, and none of the recruiter-private surfaces are reachable from
 * here. Tenant isolation itself is enforced by the backend, not by this layout.
 */
export default async function CandidateLayout({ children }: LayoutProps<"/">) {
  const [{ session, workspace }, locale] = await Promise.all([
    requirePersonalWorkspace(),
    getLocale(),
  ]);
  const matchCacheKey = jobMatchCacheKey(session.id, locale);

  return (
    <JobMatchStateProvider key={matchCacheKey} cacheKey={matchCacheKey}>
      <AppShell user={session} workspace={workspace}>
        {children}
      </AppShell>
    </JobMatchStateProvider>
  );
}
