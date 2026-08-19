/**
 * Recruitment integrations the product intends to support.
 *
 * None can be connected: the API has no integration endpoints, no credential
 * storage and no OAuth callbacks. Every entry therefore reports what it is
 * actually waiting on. There is deliberately no "Connected" state anywhere in
 * this file — a connection the backend cannot hold would be a lie about where a
 * customer's candidate data is flowing.
 *
 * LinkedIn and Indeed are listed as requiring partner approval because that is
 * the real constraint: their candidate data is not available without it, and
 * the product will not scrape or imitate private APIs to work around that.
 */

export type IntegrationAvailability = "planned" | "requires_partner_approval";

export interface IntegrationDefinition {
  id: string;
  name: string;
  description: string;
  availability: IntegrationAvailability;
}

export interface IntegrationGroup {
  id: string;
  title: string;
  description: string;
  integrations: IntegrationDefinition[];
}

export const INTEGRATION_AVAILABILITY_LABELS: Record<
  IntegrationAvailability,
  string
> = {
  planned: "Not connected",
  requires_partner_approval: "Requires partner approval",
};

export const INTEGRATION_GROUPS: IntegrationGroup[] = [
  {
    id: "email",
    title: "Email",
    description:
      "Pull applications that arrive as email attachments into the same processing pipeline as uploaded resumes.",
    integrations: [
      {
        id: "gmail",
        name: "Gmail",
        description: "Read applications from a shared recruiting inbox.",
        availability: "planned",
      },
      {
        id: "outlook",
        name: "Outlook",
        description: "Read applications from a Microsoft 365 recruiting inbox.",
        availability: "planned",
      },
    ],
  },
  {
    id: "job-boards",
    title: "Job boards",
    description:
      "Receive applicants from job boards so every source lands in one pipeline.",
    integrations: [
      {
        id: "saramin",
        name: "Saramin",
        description: "Korean job board.",
        availability: "planned",
      },
      {
        id: "wanted",
        name: "Wanted",
        description: "Korean tech hiring platform.",
        availability: "planned",
      },
      {
        id: "jobkorea",
        name: "JobKorea",
        description: "Korean job board.",
        availability: "planned",
      },
      {
        id: "jumpit",
        name: "Jumpit",
        description: "Korean developer hiring platform.",
        availability: "planned",
      },
      {
        id: "linkedin",
        name: "LinkedIn",
        description:
          "Available only through LinkedIn's partner programme — the product will not scrape or imitate private endpoints.",
        availability: "requires_partner_approval",
      },
      {
        id: "indeed",
        name: "Indeed",
        description:
          "Available only through Indeed's partner programme, on the same terms.",
        availability: "requires_partner_approval",
      },
    ],
  },
];
