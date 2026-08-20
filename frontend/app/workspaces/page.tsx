import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getTranslations } from "@/lib/i18n/server";
import { WorkspacePicker } from "@/components/layout/WorkspacePicker";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.workspaces.title };
}

/**
 * The workspace picker.
 *
 * Reached when the access token names no organization: a job seeker who also
 * holds memberships, or someone whose active membership was revoked. It is
 * deliberately outside the `(app)` group — that layout requires an active
 * organization, which is exactly what is missing here.
 */
export default async function WorkspacesPage() {
  const session = await requireSession();
  const d = await getTranslations();

  if (session.accountType === "CANDIDATE") redirect("/jobs");

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5 py-10">
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        {d.workspaces.title}
      </h1>
      <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">
        {d.workspaces.description}
      </p>

      <WorkspacePicker
        memberships={session.memberships}
      />
    </main>
  );
}
