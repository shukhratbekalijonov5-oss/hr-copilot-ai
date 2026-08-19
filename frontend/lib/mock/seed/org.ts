import type {
  AiPreferences,
  Organization,
  SecuritySettings,
  TeamMember,
  User,
} from "@/lib/types";

/**
 * Fixed timestamps keep server and client renders identical. Nothing here is
 * generated at import time on purpose.
 */
export const NOW = "2026-08-20T09:00:00.000Z";

export const organization: Organization = {
  id: "org-1",
  name: "Northwind Talent",
  slug: "northwind-talent",
  industry: "Technology / Staffing",
  companySize: "51–200",
  website: "https://northwind-talent.example",
  timezone: "Asia/Tashkent",
  createdAt: "2025-11-04T10:12:00.000Z",
};

export const currentUser: User = {
  id: "usr-1",
  organizationId: organization.id,
  fullName: "Shukhratbek Alijonov",
  email: "shukhratbekalijonov4@gmail.com",
  role: "owner",
  jobTitle: "Head of Talent",
  avatarUrl: null,
  createdAt: "2025-11-04T10:12:00.000Z",
  lastActiveAt: "2026-08-20T08:41:00.000Z",
};

export const team: TeamMember[] = [
  {
    id: "usr-1",
    fullName: "Shukhratbek Alijonov",
    email: "shukhratbekalijonov4@gmail.com",
    role: "owner",
    status: "active",
    invitedAt: "2025-11-04T10:12:00.000Z",
  },
  {
    id: "usr-2",
    fullName: "Dilnoza Karimova",
    email: "dilnoza.k@northwind-talent.example",
    role: "admin",
    status: "active",
    invitedAt: "2025-11-18T09:00:00.000Z",
  },
  {
    id: "usr-3",
    fullName: "Marcus Lindqvist",
    email: "marcus.l@northwind-talent.example",
    role: "recruiter",
    status: "active",
    invitedAt: "2026-01-12T14:30:00.000Z",
  },
  {
    id: "usr-4",
    fullName: "Aziza Rakhimova",
    email: "aziza.r@northwind-talent.example",
    role: "recruiter",
    status: "active",
    invitedAt: "2026-03-02T11:05:00.000Z",
  },
  {
    id: "usr-5",
    fullName: "Tom Beckett",
    email: "tom.b@northwind-talent.example",
    role: "viewer",
    status: "invited",
    invitedAt: "2026-08-14T16:20:00.000Z",
  },
];

export const aiPreferences: AiPreferences = {
  requireCitations: true,
  flagUncertainForReview: true,
  redactContactDetails: false,
  summaryLanguage: "en",
};

export const securitySettings: SecuritySettings = {
  twoFactorEnabled: false,
  sessionTimeoutMinutes: 480,
  lastPasswordChangeAt: "2026-05-19T08:00:00.000Z",
};
