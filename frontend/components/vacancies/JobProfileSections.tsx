import type { ReactNode } from "react";
import { Badge, Chip } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import {
  countryLabel,
  formatJobLocation,
  formatSalary,
  jobProfileSections,
  languageLabel,
} from "@/lib/vacancy/job-profile";
import { format, formatDateFor } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { JobProfile, VacancyLanguageRequirement } from "@/lib/types";

/**
 * The structured job profile, rendered.
 *
 * ONE component for both audiences — the recruiter's vacancy page and the
 * candidate's job posting — because the two must never disagree about what a
 * job says. A recruiter who states "visa sponsorship: available" needs to see
 * the same sentence the candidate reads.
 *
 * A section with nothing stated does not render at all. 209 vacancies predate
 * this model, and giving each of them eight sections of "Not specified" would
 * bury the description they DO have. Within a rendered section, an individual
 * blank field still says "Not specified" — there the reader is already looking
 * at the row and the absence is the answer.
 */
interface JobProfileSectionsProps {
  profile: JobProfile;
  /** The pre-structured free-text location; the fallback for old postings. */
  legacyLocation: string | null;
  languages: VacancyLanguageRequirement[];
  d: Dictionary;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className="text-[13.5px] text-ink">{children}</dd>
    </div>
  );
}

function NotSpecified({ d }: { d: Dictionary }) {
  return <span className="text-ink-muted">{d.jobProfile.notSpecified}</span>;
}

function ChipList({ values }: { values: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <li key={value}>
          <Chip>{value}</Chip>
        </li>
      ))}
    </ul>
  );
}

export function JobProfileSections({
  profile,
  legacyLocation,
  languages,
  d,
}: JobProfileSectionsProps) {
  const salary = formatSalary(profile, d);
  const location = formatJobLocation(profile, legacyLocation, d);

  return (
    <>
      {jobProfileSections.compensation(profile) ? (
        <Card>
          <CardHeader title={d.jobProfile.compensation} />
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Fact label={d.jobProfile.salary}>
                {salary ?? <NotSpecified d={d} />}
              </Fact>
              {profile.salaryNegotiable ? (
                <Fact label={d.jobProfile.salary}>
                  <Badge>{d.jobProfile.negotiable}</Badge>
                </Fact>
              ) : null}
            </dl>
          </CardBody>
        </Card>
      ) : null}

      {jobProfileSections.location(profile, legacyLocation) ? (
        <Card>
          <CardHeader title={d.jobProfile.locationWork} />
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Fact label={d.jobProfile.location}>
                {location ?? <NotSpecified d={d} />}
              </Fact>
              <Fact label={d.jobProfile.workModeLabel}>
                {profile.workMode ? (
                  d.workMode[profile.workMode]
                ) : (
                  <NotSpecified d={d} />
                )}
              </Fact>
              {profile.officeDaysPerWeek !== null ? (
                <Fact label={d.jobProfile.officeDays}>
                  {format(d.jobProfile.officeDaysValue, {
                    count: profile.officeDaysPerWeek,
                  })}
                </Fact>
              ) : null}
              {profile.remoteCountriesAllowed.length > 0 ? (
                <Fact label={d.jobProfile.remoteCountries}>
                  <ChipList
                    values={profile.remoteCountriesAllowed.map((code) =>
                      countryLabel(code, d),
                    )}
                  />
                </Fact>
              ) : null}
            </dl>
          </CardBody>
        </Card>
      ) : null}

      {jobProfileSections.experience(profile) ? (
        <Card>
          <CardHeader title={d.jobProfile.experience} />
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Fact label={d.jobProfile.seniority}>
                {profile.seniorityLevel ? (
                  d.seniorityLevel[profile.seniorityLevel]
                ) : (
                  <NotSpecified d={d} />
                )}
              </Fact>
              <Fact label={d.jobProfile.minExperience}>
                {profile.minExperienceYears !== null ? (
                  format(d.jobProfile.yearsValue, {
                    count: profile.minExperienceYears,
                  })
                ) : (
                  <NotSpecified d={d} />
                )}
              </Fact>
              <Fact label={d.jobProfile.preferredExperience}>
                {profile.preferredExperienceYears !== null ? (
                  format(d.jobProfile.yearsValue, {
                    count: profile.preferredExperienceYears,
                  })
                ) : (
                  <NotSpecified d={d} />
                )}
              </Fact>
            </dl>
          </CardBody>
        </Card>
      ) : null}

      {languages.length > 0 ? (
        <Card>
          <CardHeader title={d.jobProfile.languages} />
          <CardBody>
            <ul className="flex flex-col gap-2">
              {languages.map((language) => (
                <li
                  key={language.languageCode}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-muted/40 px-3 py-2"
                >
                  <span className="text-[13.5px] font-medium text-ink">
                    {languageLabel(language.languageCode, d)}
                  </span>
                  <Badge>{d.languageLevel[language.level]}</Badge>
                  <span className="text-[12.5px] text-ink-muted">
                    {language.required
                      ? d.jobProfile.required
                      : d.jobProfile.preferred}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {jobProfileSections.workAuthorization(profile) ? (
        <Card>
          <CardHeader title={d.jobProfile.workAuthorization} />
          <CardBody className="flex flex-col gap-4">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Fact label={d.jobProfile.foreignApplicants}>
                {profile.foreignApplicantsAccepted === null ? (
                  <NotSpecified d={d} />
                ) : profile.foreignApplicantsAccepted ? (
                  d.jobProfile.yes
                ) : (
                  d.jobProfile.no
                )}
              </Fact>
              <Fact label={d.jobProfile.visaSponsorshipLabel}>
                {/*
                  UNKNOWN renders as its own label rather than as a blank: the
                  employer not having decided is a different answer from "no",
                  and a candidate planning a move needs to see which it is.
                */}
                {d.visaSponsorship[profile.visaSponsorship]}
              </Fact>
              {profile.existingWorkAuthorizationRequired !== null ? (
                <Fact label={d.jobProfile.existingWorkAuth}>
                  {profile.existingWorkAuthorizationRequired
                    ? d.jobProfile.existingWorkAuthRequired
                    : d.jobProfile.existingWorkAuthNotRequired}
                </Fact>
              ) : null}
              {profile.eligibleVisaTypes.length > 0 ? (
                <Fact label={d.jobProfile.eligibleVisas}>
                  <ChipList values={profile.eligibleVisaTypes} />
                </Fact>
              ) : null}
              {profile.citizenshipRequirement === "SPECIFIC" ? (
                <Fact label={d.jobProfile.eligibleNationalities}>
                  <ChipList
                    values={profile.eligibleNationalities.map((code) =>
                      countryLabel(code, d),
                    )}
                  />
                </Fact>
              ) : null}
            </dl>
            <p className="text-[12px] text-ink-muted">
              {d.jobProfile.visaDisclaimer}
            </p>
          </CardBody>
        </Card>
      ) : null}

      {jobProfileSections.education(profile) ? (
        <Card>
          <CardHeader title={d.jobProfile.education} />
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-2">
              {profile.requiredEducation ? (
                <Fact label={d.jobProfile.requiredEducation}>
                  {d.educationLevel[profile.requiredEducation]}
                </Fact>
              ) : null}
              {profile.preferredEducation ? (
                <Fact label={d.jobProfile.preferredEducation}>
                  {d.educationLevel[profile.preferredEducation]}
                </Fact>
              ) : null}
              {profile.requiredCertifications.length > 0 ? (
                <Fact label={d.jobProfile.requiredCertifications}>
                  <ChipList values={profile.requiredCertifications} />
                </Fact>
              ) : null}
              {profile.preferredCertifications.length > 0 ? (
                <Fact label={d.jobProfile.preferredCertifications}>
                  <ChipList values={profile.preferredCertifications} />
                </Fact>
              ) : null}
              {profile.domainExperience.length > 0 ? (
                <Fact label={d.jobProfile.domainExperience}>
                  <ChipList values={profile.domainExperience} />
                </Fact>
              ) : null}
            </dl>
          </CardBody>
        </Card>
      ) : null}

      {jobProfileSections.benefits(profile) ? (
        <Card>
          <CardHeader title={d.jobProfile.benefits} />
          <CardBody className="flex flex-col gap-2">
            <ChipList
              values={profile.benefits.map((benefit) => d.benefit[benefit])}
            />
            {profile.benefitsOther ? (
              <p className="text-[13px] text-ink-muted">
                {profile.benefitsOther}
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {jobProfileSections.timeline(profile) ? (
        <Card>
          <CardHeader title={d.jobProfile.timeline} />
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-2">
              {profile.applicationDeadline ? (
                <Fact label={d.jobProfile.deadline}>
                  {formatDateFor(profile.applicationDeadline, d)}
                </Fact>
              ) : null}
              {profile.expectedStartDate ? (
                <Fact label={d.jobProfile.expectedStart}>
                  {formatDateFor(profile.expectedStartDate, d)}
                </Fact>
              ) : null}
              {profile.openingsCount !== null ? (
                <Fact label={d.jobProfile.openings}>
                  {profile.openingsCount}
                </Fact>
              ) : null}
              {profile.hiringUrgency ? (
                <Fact label={d.jobProfile.urgency}>
                  {d.hiringUrgency[profile.hiringUrgency]}
                </Fact>
              ) : null}
              {profile.contractDurationMonths !== null ? (
                <Fact label={d.jobProfile.contractDuration}>
                  {format(d.jobProfile.monthsValue, {
                    count: profile.contractDurationMonths,
                  })}
                </Fact>
              ) : null}
            </dl>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
