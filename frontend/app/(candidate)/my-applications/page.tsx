import type { Metadata } from "next";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { UnavailableState } from "@/components/ui/UnavailableState";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { BriefcaseIcon } from "@/components/ui/icons";
import { BACKEND_CAPABILITIES } from "@/lib/capabilities";
import { getTranslations } from "@/lib/i18n/server";
import { APPLICATION_STATUSES } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.personal.myApplications };
}

export default async function MyApplicationsPage() {
  await requirePersonalWorkspace();
  const d = await getTranslations();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={d.personal.myApplications}
        description={d.personal.myApplicationsDescription}
      />

      {!BACKEND_CAPABILITIES.candidateAccount ? (
        <div className="flex flex-col gap-4">
          <UnavailableState
            icon={<BriefcaseIcon className="size-5" />}
            title={d.personal.myApplicationsUnavailable}
            description={d.personal.myApplicationsUnavailableHint}
            requires={d.personal.myApplicationsRequires}
          />

          {/* The vocabulary is settled even though the data is not: candidates
              see plain-language stages, never internal recruiter wording. */}
          <Card>
            <CardHeader
              title={d.personal.stagesTitle}
              description={d.personal.stagesHint}
            />
            <CardBody>
              <ul className="flex flex-col gap-2">
                {APPLICATION_STATUSES.map((status) => (
                  <li
                    key={status}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-muted/40 px-3 py-2"
                  >
                    <Badge tone="neutral">
                      {d.status.candidateStage[status]}
                    </Badge>
                    <span className="text-[12.5px] text-ink-muted">
                      {d.status.candidateStageHint[status]}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
