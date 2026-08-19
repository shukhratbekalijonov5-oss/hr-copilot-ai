import type { Metadata } from "next";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { UnavailableState } from "@/components/ui/UnavailableState";
import { UserIcon } from "@/components/ui/icons";
import { BACKEND_CAPABILITIES } from "@/lib/capabilities";
import { format } from "@/lib/i18n/format";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.personal.myProfile };
}

export default async function MyProfilePage() {
  const { session } = await requirePersonalWorkspace();
  const d = await getTranslations();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={d.personal.myProfile}
        description={d.personal.myProfileDescription}
      />

      {!BACKEND_CAPABILITIES.candidateAccount ? (
        <UnavailableState
          icon={<UserIcon className="size-5" />}
          title={d.personal.myProfileUnavailable}
          description={format(d.personal.myProfileUnavailableHint, {
            email: session.email,
          })}
          requires={d.personal.myProfileRequires}
        />
      ) : null}
    </div>
  );
}
