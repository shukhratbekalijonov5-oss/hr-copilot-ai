import type { Metadata } from "next";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { UnavailableState } from "@/components/ui/UnavailableState";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { BriefcaseIcon } from "@/components/ui/icons";
import { BACKEND_CAPABILITIES } from "@/lib/capabilities";
import { CANDIDATE_STATUS_LABELS } from "@/lib/candidate/status";
import { APPLICATION_STATUSES } from "@/lib/types";

export const metadata: Metadata = { title: "My applications" };

export default async function MyApplicationsPage() {
  await requirePersonalWorkspace();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="My applications"
        description="Every role you have applied to, and where each one stands."
      />

      {!BACKEND_CAPABILITIES.candidateAccount ? (
        <div className="flex flex-col gap-4">
          <UnavailableState
            icon={<BriefcaseIcon className="size-5" />}
            title="Applications are tracked per organization, not per person"
            description="An application currently points at a recruiter-owned candidate record inside one organization. Nothing links those records to the person who applied, so there is no way to look up “my” applications."
            requires={[
              "A CandidateAccount owned by the signed-in user",
              "A link from Application to that account, so a job seeker can read their own applications without belonging to the organization",
            ]}
          />

          {/* The vocabulary is settled even though the data is not: candidates
              see plain-language stages, never internal recruiter wording. */}
          <Card>
            <CardHeader
              title="How stages will read"
              description="Recruiters own every transition — nothing here moves on its own."
            />
            <CardBody>
              <ul className="flex flex-col gap-2">
                {APPLICATION_STATUSES.map((status) => (
                  <li
                    key={status}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-muted/40 px-3 py-2"
                  >
                    <Badge tone="neutral">{CANDIDATE_STATUS_LABELS[status]}</Badge>
                    <span className="text-[12.5px] text-ink-muted">
                      {CANDIDATE_STATUS_DESCRIPTIONS[status]}
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

/** Plain-language explanations shown to the applicant, not to recruiters. */
const CANDIDATE_STATUS_DESCRIPTIONS: Record<string, string> = {
  NEW: "Your application has been received.",
  REVIEWING: "Someone on the hiring team is reading your application.",
  INTERVIEW: "You have reached the interview stage.",
  OFFER: "An offer is being prepared or has been sent.",
  HIRED: "You accepted the role.",
  REJECTED: "The team decided not to move forward.",
  WITHDRAWN: "You withdrew this application.",
};
