/**
 * Every query key in one place.
 *
 * Keys are built by function so a typo cannot silently create a second cache
 * entry that never invalidates — the bug where a list refuses to refresh
 * after a mutation almost always starts as a hand-written key array.
 */
export const queryKeys = {
  session: ["session"] as const,

  candidate: {
    account: ["candidate", "account"] as const,
    evidence: ["candidate", "evidence"] as const,
    preferences: ["candidate", "preferences"] as const,
    documents: ["candidate", "documents"] as const,
    applications: (page: number) => ["candidate", "applications", page] as const,
    savedJobs: (page: number) => ["candidate", "savedJobs", page] as const,
    jobMatches: (locale: string, page: number) =>
      ["candidate", "jobMatches", locale, page] as const,
    externalJobs: (query: string, page: number) =>
      ["candidate", "externalJobs", query, page] as const,
  },

  recruiter: {
    dashboard: ["recruiter", "dashboard"] as const,
    vacancies: (page: number) => ["recruiter", "vacancies", page] as const,
    candidates: (vacancyId: string | null, page: number) =>
      ["recruiter", "candidates", vacancyId, page] as const,
    candidate: (id: string) => ["recruiter", "candidate", id] as const,
    vacancy: (id: string) => ["recruiter", "vacancy", id] as const,
  },

  jobs: {
    public: (query: string, page: number) => ["jobs", "public", query, page] as const,
    detail: (slug: string) => ["jobs", "detail", slug] as const,
  },

  chat: {
    conversations: ["chat", "conversations"] as const,
    messages: (conversationId: string) =>
      ["chat", "messages", conversationId] as const,
  },

  notifications: {
    list: (page: number) => ["notifications", "list", page] as const,
    unreadCount: ["notifications", "unreadCount"] as const,
  },

  billing: {
    summary: ["billing", "summary"] as const,
  },
} as const;
