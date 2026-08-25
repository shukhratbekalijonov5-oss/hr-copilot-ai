/**
 * English UI strings — the source of truth for the `Dictionary` type.
 *
 * Every other locale is typed as `Dictionary`, so a key added here that is not
 * translated is a compile error rather than an English string leaking into a
 * Korean screen.
 *
 * Rules that hold in every locale:
 *  - Nothing here scores, ranks or recommends a candidate. Statuses describe
 *    the *evidence*, never the person.
 *  - Raw resume text and citation snippets are never translated; only the
 *    chrome around them is.
 *  - Values are plain JSON (strings, string arrays, plural records) because the
 *    active dictionary crosses the server/client boundary as a prop.
 */

/** Plural forms selected with `Intl.PluralRules`. `other` is always required. */
export interface Plural {
  one?: string;
  few?: string;
  many?: string;
  other: string;
}

const en = {
  footer: {
    tagline: "AI-powered hiring and job discovery workspace for candidates and recruiters.",
    blurb: "Find stronger matches, understand the evidence behind them, and manage hiring in one place.",
    contact: "Contact",
    phoneLabel: "Call",
    emailLabel: "Email",
    social: "Follow",
    rights: "© 2026 HR Copilot AI",
  },

  pwa: {
    offlineTitle: "You're offline",
    offlineHint: "Reconnect to continue. Nothing here updates while you are offline.",
    offlineRetry: "Try again",
    installTitle: "Install HR Copilot",
    installHint: "Add it to your home screen for a full-screen app.",
    install: "Install",
    installDismiss: "Not now",
    iosInstallTitle: "Add to Home Screen",
    iosInstallHint: "Tap Share, then choose Add to Home Screen.",
  },

  meta: {
    appName: "HR Copilot AI",
    tagline: "Recruitment intelligence",
    description:
      "Evidence-first recruitment intelligence: search resumes in plain language, trace every claim back to its source, and keep hiring decisions with people.",
  },

  /**
   * Date, time and number formatting data.
   *
   * Held in the dictionary rather than taken from `Intl.DateTimeFormat`,
   * `Intl.RelativeTimeFormat` or `Intl.NumberFormat` because those read the
   * host's ICU tables, and Node's and the browser's disagree — Chrome has no
   * Uzbek date patterns and renders "2026 M08 20" where Node renders
   * "20-avg, 2026". A server/client disagreement here is a React hydration
   * mismatch, which silently breaks event handlers on the page.
   *
   * `Intl.PluralRules` is *not* replaced: its output is identical in both
   * runtimes for all four locales, so `plural()` still uses it.
   *
   * Timestamps are rendered in UTC so a server in one zone and a reader in
   * another produce the same string.
   */
  datetime: {
    months: [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ],
    date: "{month} {day}, {year}",
    dateTime: "{month} {day}, {time}",
    time: "{hour}:{minute}",
    justNow: "just now",
    minutesAgo: {
      one: "{count} minute ago",
      other: "{count} minutes ago",
    } as Plural,
    hoursAgo: {
      one: "{count} hour ago",
      other: "{count} hours ago",
    } as Plural,
    daysAgo: {
      one: "{count} day ago",
      other: "{count} days ago",
    } as Plural,
    groupSeparator: ",",
    decimalSeparator: ".",
  },

  common: {
    save: "Save changes",
    saved: "Saved",
    cancel: "Cancel",
    edit: "Edit",
    close: "Close",
    retry: "Try again",
    search: "Search",
    filter: "Filter",
    clear: "Clear",
    viewAll: "View all",
    back: "Back",
    next: "Next",
    previous: "Previous",
    open: "Open",
    loading: "Loading",
    notRecorded: "Not recorded",
    notSet: "Title not set",
    none: "None",
    page: "page",
    showMore: "Show more",
    showLess: "Show less",
    pagination: "Pagination",
    pageOf: "{page} / {total}",
    pageNumber: "Page {page}",
    language: "Language",
    changeLanguage: "Change language",
    humanDecision: "Human decision required",
    of: "{count} of {total}",
    years: {
      one: "{count} year",
      other: "{count} years",
    } as Plural,
    candidates: {
      one: "{count} candidate",
      other: "{count} candidates",
    } as Plural,
    files: {
      one: "{count} file",
      other: "{count} files",
    } as Plural,
    documents: {
      one: "{count} document",
      other: "{count} documents",
    } as Plural,
    passages: {
      one: "{count} matching passage",
      other: "{count} matching passages",
    } as Plural,
  },

  theme: {
    switchToDark: "Switch to dark theme",
    switchToLight: "Switch to light theme",
  },

  palette: {
    title: "Quick navigation",
    open: "Open quick navigation",
    placeholder: "Jump to a page...",
    empty: "No matching page.",
    hint: "Enter to open · Arrow keys to move · Esc to close",
  },

  primaryNav: {
    label: "Main navigation",
    close: "Close",
    sections: {
      career: "Career",
      careerHint: "Everything about your job hunt.",
      aiSearch: "AI Search",
      aiSearchHint: "Ranked against your own evidence.",
      hiring: "Hiring",
      hiringHint: "Your vacancies and the people in them.",
      more: "More",
      moreHint: "Your account and preferences.",
    },
    comingSoon: "Coming soon",
    hints: {
      findJobs: "Browse every open role.",
      savedJobs: "The roles you kept.",
      myApplications: "Where each application stands.",
      internalAiJobs: "Roles published on HR Copilot.",
      externalAiJobs: "Roles published elsewhere.",
      myProfile: "Your evidence and details.",
      jobPreferences: "What you are looking for.",
      plans: "Your subscription.",
      settings: "Account settings.",
      notifications: "Recent activity.",
      vacancies: "Roles you created.",
      candidates: "People who applied.",
      compare: "Compare applicants in one vacancy.",
      internalAiSearch: "Search your candidates' evidence.",
      externalAiSearch: "Sourcing beyond your applicants.",
    },
  },

  nav: {
    chats: "Chats",
    more: "More",
    roleCandidate: "Candidate",
    roleRecruiter: "Recruiter",
    sectionCommunication: "Communication",
    sectionHiring: "Hiring",
    sectionAiTools: "AI tools",
    sectionHome: "Home",
    sectionCareer: "Career",
    sectionProfile: "Profile",
    sectionAccount: "Account",
    home: "Dashboard",
    sectionWorkspace: "Workspace",
    sectionJobSearch: "Job search",
    sectionFindJobs: "Find jobs",
    sectionAiJobSearch: "AI job search",
    sectionYourSearch: "Your job search",
    plans: "Plans",
    dashboard: "Dashboard",
    vacancies: "Vacancies",
    candidates: "Candidates",
    aiSearch: "AI Search",
    compare: "Compare",
    processing: "Processing",
    settings: "Settings",
    findJobs: "Normal job search",
    externalAiJobs: "External AI Jobs",
    internalAiJobs: "Internal AI Jobs",
    jobPreferences: "Job preferences",
    myApplications: "My applications",
    interviewChats: "Interview chats",
    savedJobs: "Saved jobs",
    myProfile: "My profile",
    breadcrumb: "Breadcrumb",
    notePersonal:
      "Your profile and applications are yours. Recruiters only see what you send them.",
    noteOrganization:
      "Every shortlist and rejection stays a human decision. The copilot only shows evidence.",
    profile: "Profile",
    workspaceSettings: "Workspace settings",
    signOut: "Sign out",
    notifications: "Notifications",
    notificationsUnavailable: "Notifications are not available yet",
    personal: "Personal",
    organizations: "Organizations",
    personalUnavailable:
      "Job seeker profiles are not available yet — the API has no candidate account to sign in to.",
    multiOrganizationNote:
      "Belonging to more than one organization needs a membership model the API does not have yet.",
    oneOfOne: "1 of 1",
  },

  notifications: {
      groupToday: "Today",
      groupWeek: "This week",
      groupEarlier: "Earlier",
    title: "Notifications",
    bellLabel: "Open notifications",
    bellUnreadLabel: "Open notifications, {count} unread",
    unread: "{count} unread",
    allCaughtUp: "All caught up",
    markAllRead: "Mark all read",
    loadMore: "Load more",
    noDestination: "No linked page",
    empty: {
      hrTitle: "No recruiting notifications",
      hrDescription:
        "Applications, candidate messages, and CV processing updates will appear here.",
      candidateTitle: "No notifications",
      candidateDescription:
        "Messages, interview invites, and application updates will appear here.",
    },
    errors: {
      load: "Could not load notifications.",
      unavailable: "Notifications are temporarily unavailable. Try again shortly.",
      markRead: "Could not mark this notification as read.",
      markAll: "Could not mark notifications as read.",
    },
    fallbacks: {
      candidateUnavailable: "Candidate unavailable",
      vacancyUnavailable: "Vacancy unavailable",
      recruiter: "Recruiter",
    },
    messages: {
      newMessageFallback: "New message",
      interviewInvitation: "You have been invited to an interview.",
      vacancyDeleted: "Your applied vacancy “{vacancy}” was deleted.",
      applicationRejected: "The hiring team decided not to move forward.",
    },
    types: {
      NEW_APPLICATION: "New application",
      NEW_MESSAGE: "New message",
      INTERVIEW_INVITATION: "Interview invitation",
      VACANCY_DELETED: "Vacancy update",
      APPLICATION_REJECTED: "Application update",
    },
  },

  auth: {
    candidate: "Candidate",
    organization: "Organization",
    chooseSignIn: "Choose how to sign in",
    chooseRegistration: "Choose account type",
    chooseAccountTypeHint:
      "Candidate and organization accounts are separate. Pick the door that matches your account.",
    candidateAuthHint:
      "Find jobs, manage applications, save roles and use AI Job Match.",
    organizationAuthHint:
      "Manage vacancies, candidates, evidence search and recruiting workflows.",
    accountTypeExclusive:
      "One email can be either Candidate or Organization, never both.",
    signIn: "Sign in",
    candidateSignIn: "Candidate sign in",
    organizationSignIn: "Organization sign in",
    signingIn: "Signing in",
    signInSubtitle: "Use your work account to reach your organization’s pipeline.",
    candidateSignInSubtitle:
      "Use your candidate account to find jobs and manage applications.",
    organizationSignInSubtitle:
      "Use your organization account to manage hiring workspaces.",
    createAccount: "Create your workspace",
    createCandidateAccount: "Create candidate account",
    createOrganizationAccount: "Create organization account",
    createAccountSubtitle:
      "Set up an organization and become its first administrator.",
    email: "Email",
    emailPlaceholder: "you@company.com",
    password: "Password",
    fullName: "Full name",
    organizationName: "Organization name",
    organizationSlug: "Workspace URL",
    showPassword: "Show password",
    hidePassword: "Hide password",
    noAccount: "No account yet?",
    createOne: "Create one",
    haveAccount: "Already have an account?",
    signInInstead: "Sign in",
    couldNotSignIn: "Could not sign in.",
    couldNotRegister: "Could not create the workspace.",
    candidateAccountUseCandidateSignIn:
      "This is a candidate account. Sign in through Candidate.",
    organizationAccountUseOrganizationSignIn:
      "This account belongs to an organization. Sign in through Organization.",
    emailAlreadyRegistered:
      "This email is already registered. Sign in instead.",
    emailBelongsToCandidate:
      "This email is already registered as a candidate account.",
    emailBelongsToOrganization:
      "This email is already registered as an organization account.",
    creating: "Creating",
    heroTitle: "Read every resume properly, without reading every resume.",
    heroPoints: [
      "Every extracted claim links back to the page it came from.",
      "Search resumes in plain language across your whole pipeline.",
      "Shortlisting and rejection stay human decisions, always.",
    ],
  },

  validation: {
    emailRequired: "Email is required.",
    workEmailRequired: "Work email is required.",
    emailInvalid: "Enter a valid email address.",
    passwordRequired: "Password is required.",
    passwordMinLength: "Use at least {min} characters.",
    fullNameRequired: "Full name is required.",
    fullNameShort: "Enter your full name.",
    organizationNameRequired: "Company or organization name is required.",
    slugRequired: "Workspace URL is required.",
    slugPattern: "Use lowercase letters, numbers and hyphens only.",
    emailInUse: "That email address is already in use.",
    websiteUrlInvalid: "Enter a valid URL starting with http:// or https://.",
  },

  register: {
    subtitle: "Sets up your organization and makes you its owner.",
    candidateSubtitle:
      "Create your job-seeker account. No company or workspace is needed.",
    organizationSubtitle: "Set up your organization and become its owner.",
    fullNamePlaceholder: "Jane Doe",
    workEmail: "Work email",
    workEmailPlaceholder: "jane@company.com",
    organizationLabel: "Company or organization",
    organizationPlaceholder: "Northwind Talent",
    slugLabel: "Workspace URL",
    slugPlaceholder: "northwind-talent",
    slugHint: "Lowercase letters, numbers and hyphens. Must be unique.",
    preferredLanguage: "Preferred language",
    passwordPlaceholder: "At least {min} characters",
    passwordHint: "At least {min} characters.",
    submit: "Create workspace",
    submitCandidate: "Create candidate account",
    submitOrganization: "Create organization account",
    submitting: "Creating workspace",
    submittingCandidate: "Creating candidate account",
    submittingOrganization: "Creating organization account",
  },

  dashboard: {
    title: "Dashboard",
    description: "Where your pipeline stands right now.",
    newVacancy: "New vacancy",
    statTotalCandidates: "Total candidates",
    statTotalCandidatesHint: "Across every vacancy in this workspace",
    statActiveVacancies: "Active vacancies",
    statActiveVacanciesHint: "Open and accepting candidates",
    statResumesProcessing: "Resumes processing",
    statResumesProcessingHint: "In the parse → index pipeline",
    statCompletedAnalyses: "Completed analyses",
    statCompletedAnalysesHint: "Documents indexed and ready to read",
    quickCreateVacancy: "Create vacancy",
    quickCreateVacancyHint: "Define requirements the copilot will look for.",
    quickReviewApplicants: "Review applicants",
    quickReviewApplicantsHint: "See who has applied to your vacancies.",
    recentVacancies: "Recent vacancies",
    recentCandidates: "Recent candidates",
    processingActivity: "Processing activity",
    processingActivityHint: "Documents that reached each stage",
    latestProcessing: "Latest processing",
    latestProcessingHint: "Most recent jobs",
    openProcessingQueue: "Open processing queue",
    noVacancies: "No vacancies yet",
    noVacanciesHint:
      "Create your first vacancy to tell the copilot what to look for.",
    noCandidates: "No applicants yet",
    noCandidatesHint:
      "Candidates who apply to your vacancies will appear here.",
    nothingProcessed: "Nothing processed yet",
    nothingProcessedHint:
      "Uploaded documents appear here as they move through the pipeline.",
    noDepartment: "No department",
    noLocation: "No location",
    document: "Document",
  },

  vacancies: {
    title: "Vacancies",
    description:
      "Every role you are hiring for, and the requirements each resume is checked against.",
    create: "Create vacancy",
    createTitle: "Create a vacancy",
    createDescription:
      "Requirements are what each resume is checked against, so write them the way you would ask about them.",
    searchPlaceholder: "Search vacancies",
    filterStatus: "Status",
    filterDepartment: "Department",
    allStatuses: "All statuses",
    allDepartments: "All departments",
    empty: "No vacancies yet",
    emptyHint: "Create your first vacancy to tell the copilot what to look for.",
    noMatches: "No vacancies match",
    noMatchesHint: "Clear a filter to see more roles.",
    requirements: "Requirements",
    requirement: "Requirement",
    addRequirement: "Add requirement",
    removeRequirement: "Remove requirement",
    noRequirements: "This vacancy has no requirements yet",
    noRequirementsHint:
      "Add requirements and each one will be checked against every candidate’s documents.",
    fieldTitle: "Job title",
    fieldDepartment: "Department",
    fieldLocation: "Location",
    fieldEmploymentType: "Employment type",
    fieldExperienceLevel: "Experience level",
    fieldDescription: "Description",
    requirementText: "Requirement",
    requirementType: "Type",
    requirementRequired: "Must have",
    candidatesOnVacancy: "Candidates",
    viewCandidates: "View candidates",
    compareCandidates: "Compare candidates",
    notFound: "Vacancy not found",
    notFoundHint:
      "This vacancy does not exist, or it belongs to another organization.",
    backToVacancies: "Back to vacancies",
  },

  candidates: {
    vacancyContext: "Vacancy context",
    openFullDetail: "Open full detail",
    selectToPreview: "Select a candidate",
    selectToPreviewHint: "Their details appear here.",
    title: "Candidates",
    description:
      "Everyone in your pipeline, with the state of their documents. Nobody is ranked or filtered by the model.",
    searchPlaceholder: "Search candidates",
    filterVacancy: "Vacancy",
    allVacancies: "All vacancies",
    sortBy: "Sort by",
    sortRecent: "Most recent",
    sortName: "Name",
    sortExperience: "Experience",
    empty: "No candidates yet",
    emptyHint:
      "Add a candidate and upload their resume to start building your pipeline.",
    noMatches: "No candidates match",
    noMatchesHint: "Clear a filter to see more people.",
    overview: "Candidate overview",
    currentTitle: "Current title",
    experience: "Experience",
    location: "Location",
    email: "Email",
    phone: "Phone",
    added: "First applied",
    documents: "Documents",

    // Evidence sources — files and professional links, read-only for HR.
    currentEvidence: "Current candidate evidence",
    currentEvidenceHint:
      "The candidate's live profile, files and links — as they are right now, not as submitted.",
    currentEvidenceEmpty: "The candidate currently has no files or links.",
    currentDocuments: "Documents",
    currentLinks: "Professional links",
    currentEvidenceDocument: "Document",
    openCurrentFile: "Open",
    openOriginalLink: "Open original",
    noSource: "No source selected",
    noSourceHint: "Pick a file or a link to see what was submitted.",
    originalUrl: "Original link",
    openOriginal: "Open original",
    applications: "Applications",
    applicationsHint:
      "Stage changes are recorded against the person who made them.",
    profile: "Profile",
    application: "Application",
    attempts: "Attempts",
    appliedAt: "Applied at",
    currentStatus: "Current status",
    otherVacancies: "Other vacancies",
    otherVacanciesHint:
      "Other pipelines this person is in. Each has its own independent stage.",
    noApplicationForVacancy: "No application in this vacancy",
    applicationStage: "Application stage",
    notAttached: "Not attached to a vacancy",
    notAttachedHint:
      "Attach this candidate to a vacancy to check their documents against its requirements.",
    appliedOn: "Applied {date}",
    vacancy: "Vacancy",
    updateFailed: "Update failed.",
    couldNotUpdate: "Could not update the application.",
    notFound: "Candidate not found",
    notFoundHint:
      "This candidate does not exist, or they belong to another organization.",
    backToCandidates: "Back to candidates",
    fieldFullName: "Full name",
    fieldEmail: "Email",
    fieldPhone: "Phone",
    fieldLocation: "Location",
    fieldCurrentTitle: "Current title",
    fieldExperienceYears: "Years of experience",
    tabOverview: "Overview",
    tabEvidence: "JD Evidence",
    tabSummary: "AI Summary",
    tabQuestions: "Interview Questions",
    tabAsk: "Ask",
    noDocument: "No document",
    noDocumentHint: "Upload a resume for this candidate to read it here.",
    selectDocument: "Select document",
    documentOpenFailed: "This document could not be opened. Try again shortly.",
    previewUnavailable: "The PDF preview could not be rendered here.",
    openPdf: "Open PDF",
    docxNotRenderable:
      "Browsers cannot render DOCX inline. Open the file to read it — the extracted text and its citations still appear alongside.",
    openFile: "Open {name}",
    showingCitation: "Showing citation",
    noDocuments: "No documents",
  },

  upload: {
    title: "Upload resumes",
    dropHere: "Drop resumes here",
    browse: "Choose files",
    hint: "PDF or DOCX, up to {size}.",
    unsupportedType: "{name} is not a PDF or DOCX file.",
    tooLarge: "{name} is larger than {size}.",
    uploading: "Uploading",
    uploadFailed: "Upload failed",
    remove: "Remove",
    unattachedNote:
      "Files uploaded here are stored without a candidate. To have them checked against a vacancy’s requirements, upload from a candidate’s page instead.",
    errorCodes: {
      FILE_TOO_LARGE: "That file is larger than the 50 MB limit.",
      UNSUPPORTED_FILE_TYPE: "Upload a PDF or DOCX file.",
      PERSONAL_DOCUMENT_LIMIT_REACHED:
        "You can store up to 3 documents. Delete one to upload another.",
    },
  },

  search: {
    title: "AI candidate search",
    description:
      "Ask in plain language. Every result shows the passage it came from, with its document and page.",
    label: "Search resume evidence",
    placeholder:
      "Describe what you are looking for — e.g. ran Kubernetes in production and owned the on-call rotation",
    hint: "Enter to search · Shift + Enter for a new line",
    submit: "Search",
    minLength: "Enter at least two characters to search.",
    examples: [
      "Production Kubernetes experience",
      "Redis Pub/Sub for event fan-out",
      "Designed a GraphQL schema for internal services",
      "Led a migration from a monolith to services",
    ],
    resultsCount: {
      one: "{count} candidate with matching passages",
      other: "{count} candidates with matching passages",
    } as Plural,
    reranked: "Reranked",
    considered: "{count} considered · {ms}ms",
    noResults: "No supporting passages found",
    noResultsHint:
      "Nothing in the indexed documents matches that description. Try different wording, or check that the resumes have finished processing.",
    unavailable: "Search is temporarily unavailable",
    unavailableHint:
      "The retrieval service behind search is not reachable right now, so there are no results to show. This is not the same as finding nothing — try again shortly.",
    failed: "Search failed. Try again shortly.",
    orderingNote:
      "Candidates appear in the order of their strongest matching passage. That reflects how closely text matched your query — it is not a score of the person, and it is not a hiring recommendation.",
    retrievalContext: "Retrieval context",
    unnamedCandidate: "Unnamed candidate",
    sourceDocument: "Source document",
    sourceLink: "Professional link",
    summaryTitle: "AI summary",
    searchingEvidence: "Searching candidate evidence…",
    generatingSummary: "Generating grounded summary…",
  },

  ai: {
    evidenceDrawerTitle: "Evidence",
    evidenceSnippet: "Passage",
    evidenceSource: "Source",
    evidenceFile: "File",
    evidencePage: "Page",
    evidenceLink: "Link",
    evidenceSourceUnknown: "The source was not reported for this passage.",
    sourceFile: "Document",
    sourceLink: "Link",
    viewEvidenceAction: "View evidence",
    ask: "Ask about this candidate",
    askDescription:
      "Answers are written only from passages in the uploaded documents, and every one is shown with its source.",
    askPlaceholder:
      "Ask a question about this candidate’s documents — e.g. what did they own in their last role?",
    askLabel: "Ask a grounded question",
    askSubmit: "Ask",
    generating: "Generating",
    generatingAnswer: "Reading the documents and writing an answer…",
    answer: "Answer",
    answerLocale: "Answer language",
    citations: "Sources",
    citationsCount: {
      one: "{count} source",
      other: "{count} sources",
    } as Plural,
    noCitations: "No source passages were returned with this answer.",
    supportingEvidence: "Supporting evidence",
    viewOriginalEvidence: "View original evidence",
    hideOriginalEvidence: "Hide original evidence",
    sectionLabels: {
      summary: "Summary",
      experience: "Work experience",
      projects: "Projects",
      skills: "Skills",
      education: "Education",
      certifications: "Certifications",
      languages: "Languages",
    },
    citationSourcesUnavailable:
      "This answer refers to sources that were not returned with it, so the references cannot be opened. Check its claims against the documents directly.",
    evidenceConsidered: "{count} passages considered",
    model: "Model",
    regenerate: "Generate again",
    generate: "Generate",
    minQueryLength: "Ask a question of at least three characters.",

    summaryTitle: "Grounded summary",
    summaryDescription:
      "What this candidate’s own documents state. It is not an assessment of the person and contains no score or recommendation.",
    summaryGenerate: "Generate summary",
    summaryRegenerate: "Generate again",
    summaryEmpty: "No summary generated yet",
    summaryEmptyHint:
      "Generate a summary to read what the indexed documents state, with a source behind each claim.",

    questionsTitle: "Interview questions",
    questionsDescription:
      "Prompts for a human interviewer, drawn from what the documents do and do not show. They are not an evaluation and not a score.",
    questionsGenerate: "Generate questions",
    questionsRegenerate: "Generate again",
    questionsEmpty: "No questions generated yet",
    questionsEmptyHint:
      "Generate questions to get prompts drawn from this candidate’s evidence against the vacancy’s requirements.",
    questionReason: "Why ask this",
    questionsNoVacancy: "Attach the candidate to a vacancy first",
    questionsNoVacancyHint:
      "Questions are drawn from a vacancy’s requirements, so this candidate needs an application before they can be generated.",
    questionsNone: "The generator returned no questions",
    questionsNoneHint:
      "Nothing in the documents or the requirements produced a question worth asking. That is a result, not an error.",

    mapTitle: "JD evidence mapping",
    mapDescription:
      "Each requirement on the vacancy, and what in the documents supports it.",
    mapRun: "Run mapping",
    mapRerun: "Run again",
    mapRunning: "Mapping requirements against the documents…",
    mapNotRun: "Evidence mapping has not run yet",
    mapNotRunHint:
      "Run the mapping to check every requirement on this vacancy against the candidate’s indexed documents.",
    mapLastRun: "Mapped {date}",
    mapNeverRun: "Never run",
    mapFoundCount: "{found} of {total} requirements have supporting evidence",
    mapCheckedAgainst: "Checked against {vacancy}",
    mapNoRequirements: "This vacancy has no requirements yet",
    mapNoRequirementsHint:
      "Add requirements to the vacancy and each one will be checked against the candidate’s documents.",
    mapMatchedTerms: "Matched",
    mapMissingTerms: "Not found",
    mapReason: "Why",
    mapForbidden:
      "Your role can read an evidence map but not run one. Ask a recruiter or an admin to run it.",
    noOverallScore:
      "There is no overall fit score. Each requirement is reported on its own, and the judgement stays with you.",

    statusGroundedHint: "Written from the passages cited below.",
    statusInsufficientHint:
      "The indexed documents do not contain enough to answer this. Nothing was invented to fill the gap.",
    statusNeedsReviewHint:
      "Something related was found, but it needs a person to judge it.",

    generationUnavailable: "AI generation is temporarily unavailable",
    generationUnavailableHint:
      "AI generation is temporarily unavailable. Evidence search is still available.",
    retrievalUnavailable: "Evidence retrieval is temporarily unavailable",
    retrievalUnavailableHint:
      "The service that reads indexed documents is not reachable right now, so there is nothing to search or cite. Try again shortly.",
    networkFailed: "Could not reach the server",
    networkFailedHint:
      "The request did not get through. Check your connection and try again.",
    noEvidence: "No evidence found",
    noEvidenceHint:
      "Nothing in the indexed documents supports this. That is a result about the documents, not a judgement about the candidate.",
    notProcessed: "No document has been processed yet",
    notProcessedHint:
      "AI features read indexed documents. Upload a resume and let it finish processing first.",
    stillProcessing: "The documents are still being processed",
    stillProcessingHint:
      "AI features become available once every document has finished indexing.",
    processingFailed: "Document processing failed",
    processingFailedHint:
      "This candidate’s documents could not be processed, so there is nothing to read. Check the processing queue for the reason.",
    notLinked: "This candidate is not attached to a vacancy",
    notLinkedHint:
      "Requirement mapping and interview questions both need a vacancy to compare against.",
    citationSourceLanguageNote:
      "Quoted passages stay in the language of the original document.",
  },

  evidence: {
    title: "JD Evidence",
    requirementsSummary: "{found} of {total} requirements have supporting evidence",
    checkedAgainst: "Checked against {vacancy}",
    noVacancy: "No vacancy attached",
    noVacancyHint:
      "Attach this candidate to a vacancy to check their documents against its requirements.",
    noDocuments: "No documents to read",
    noDocumentsHint:
      "Requirement evidence comes from uploaded files. Upload a resume to begin.",
    analysisRunning: "Analysis still running",
    analysisRunningHint:
      "Requirement evidence appears once every document finishes indexing.",
    processingFailed: "Document processing failed",
    processingFailedHint:
      "This candidate’s documents could not be processed, so there is no evidence to show. Check the processing queue for the reason.",
    nothingSupports:
      "Nothing in the uploaded documents supports this requirement. That is not a judgement about the candidate — ask about it in a screen.",
    openAtPage: "Open {name} at page {page}",
    openDocument: "Open {name}",
    openSource: "Open {name}",
  },

  processing: {
    title: "Processing",
    description:
      "Every uploaded document and where it sits in the parse → index pipeline.",
    pipeline: "Pipeline",
    ingested: {
      one: "{count} document ingested",
      other: "{count} documents ingested",
    } as Plural,
    searchPlaceholder: "Search file or candidate",
    searchLabel: "Search processing queue",
    filterState: "Filter by state",
    allStates: "All states",
    shownOfTotal: "{shown} of {total}",
    workInProgress: " · work in progress",
    columnDocument: "Document",
    columnProgress: "Progress",
    columnAttempts: "Attempts",
    columnUpdated: "Updated",
    columnState: "State",
    caption: "Processing queue",
    notLinked: "Not linked to a candidate",
    queueEmpty: "Queue is empty",
    queueEmptyHint:
      "Upload a resume and it will move through parsing, chunking, embedding and indexing.",
    noMatches: "Nothing matches",
    noMatchesHint: "Clear a filter to see more of the queue.",
    retryNote:
      "A failed job keeps its error so the cause is visible. There is no retry control here because the API does not expose one yet — re-upload the file to try again.",
    queueEmptyShort: "Nothing in the processing queue.",
    failed: "Failed",
    progressLabel: "{name} progress",
    stageLabel: "{stage} {reached} of {total}",
  },

  compare: {
    title: "Compare candidates",
    description:
      "Line up requirement evidence side by side, with the source passage behind every cell.",
    selectTitle: "Select candidates",
    selectDescription: "Pick {min}–{max} candidates from one vacancy.",
    selectedCount: "{count} / {max}",
    vacancy: "Vacancy",
    vacancyOption: "{title} ({count})",
    nothingToCompare: "No applicants available for comparison",
    nothingToCompareHint:
      "Once this vacancy has applicants with indexed resumes, you can line their requirement evidence up side by side.",
    noneProcessed: "No applicant on this vacancy has finished processing yet.",
    processedRatio:
      "{ready} of {total} candidates on this vacancy have finished processing. The rest appear here once their documents are indexed.",
    selectAtLeast: "At least {min} applicants are required to compare",
    selectAtLeastHint:
      "The comparison lines up requirement evidence from each applicant’s submitted documents.",
    tableCaption: "Requirement evidence for {vacancy}",
    columnRequirement: "Requirement",
    legendTitle: "What the cells mean",
    legendFound: "A passage in the documents supports this requirement.",
    legendNotFound:
      "Nothing in the documents mentions it. Absence of evidence, not evidence of absence.",
    legendReview: "Something related was found, but it needs a person to judge it.",
    legendNotRun:
      "Evidence mapping has not been run for this candidate on this vacancy yet.",
    noWinner:
      "This table compares what the documents contain. It does not rank candidates or recommend a hire — that decision stays with you.",
    couldNotBuild: "Could not build the comparison.",
    runMapping: "Run mapping for the selected candidates",
    mappingRunning: "Running evidence mapping…",
    unmappedNote:
      "{count} of the selected candidates have no stored evidence map for this vacancy. Run the mapping to fill those columns.",
  },

  /**
   * The caller's own account — shared by the recruiter settings screen and
   * the job seeker's profile, because both edit the same three fields.
   */
  account: {
    title: "Your account",
    description: "Your name, sign-in address and profile picture.",
    fullName: "Full name",
    email: "Email",
    emailHint: "This is the address you sign in with.",
    uploadPhoto: "Upload photo",
    changePhoto: "Change photo",
    removePhoto: "Remove photo",
    photoHint: "PNG, JPEG or WebP, up to 5 MB. Optional — without one you appear as your initials.",
    saveChanges: "Save changes",
    saveFailed: "Could not save your profile.",
    photoFailed: "Could not update your photo.",
    imageTypeError: "That file is not a supported image. Use a PNG, JPEG or WebP.",
    imageTooLarge: "That image is too large. The limit is 5 MB.",
  },

  settings: {
    title: "Settings",
    description: "Your profile, the organization, and who has access.",
    yourProfile: "Your profile",
    yourProfileHint: "How you appear to the rest of the workspace.",
    accountEmailNote: "Important account and subscription emails are sent to your account email.",
    fullName: "Full name",
    email: "Email",
    organization: "Organization",
    organizationHint: "Applies to everyone in this workspace.",
    organizationName: "Organization name",
    workspaceUrl: "Workspace URL",
    slugLocked: "Changing the slug would break existing links.",
    countMembers: "Members",
    countVacancies: "Vacancies",
    countCandidates: "Candidates",
    countDocuments: "Documents",
    team: "Team",
    teamAccess: {
      one: "{count} person has access to this workspace.",
      other: "{count} people have access to this workspace.",
    } as Plural,
    inviteNote:
      "The API creates teammates with a password set by an admin rather than an email invitation, so there is no invite flow here yet.",
    integrations: "Integrations",
    integrationsHint:
      "Bring applications in from email and job boards so every source lands in one pipeline.",
    integrationsUnavailable:
      "None of these can be connected yet — the API has no integration endpoints or credential storage. They are listed so the intended shape is visible; nothing here will report a connection it does not have.",
    connect: "Connect",
    security: "Security",
    sessionHandling: "Session handling",
    sessionHandlingHint:
      "Your session is held in a cookie that browser scripts cannot read. Signing out clears it; the underlying token stays valid until it expires, because the API has no revocation endpoint yet.",
    role: "Role",
    workspaceCreated: "Workspace created",
    changePassword: "Change password",
    enableTwoFactor: "Enable two-factor authentication",
    disabledNote:
      "These are disabled because the API does not expose them yet. They will do nothing until it does.",
    couldNotSave: "Could not save.",
    languageTitle: "Language",
    languageHint:
      "Sets the interface language and the language AI answers are written in. Quoted resume passages stay in their original language.",
    languageStoredLocally:
      "Your choice is kept in this browser. Your account carries a stored language that seeds it on a device that has not seen this setting, but the API exposes no field to update that language — so a change made here does not follow you.",
    organizationUrl: "Organization URL",
    organizationUrlPlaceholder: "https://northwind.example",
    organizationUrlHint: "Optional. Shown on your workspace; leave blank to remove it.",
  },

  home: {
    entries: {
      internalHint: "Rank every open role on HR Copilot against your evidence.",
      externalHint: "Search roles published on employers' own career sites.",
    },
    banner: {
      title: "Better evidence, better matches",
      description:
        "AI matching reads your resume, links and profile. The more it can read, the more precise every ranking becomes.",
      action: "Improve your profile",
    },
    title: "Your job search",
    greeting: "Welcome back, {name}",
    subtitle:
      "Everything your applications and AI matches are built from, in one place.",
    findMatchingJobs: "Find matching jobs",
    updateResume: "Update resume",
    readiness: {
      title: "Profile readiness",
      summary: "{done} of {total} complete",
      complete: "Complete",
      allDone: "Your profile is ready to be matched.",
      resume: "Add a resume",
      resumeHint: "Your resume is the main evidence AI matching reads.",
      resumeDone: "Resume uploaded",
      links: "Add a portfolio link",
      linksHint: "GitHub, a personal site or any public work.",
      linksDone: "Portfolio link added",
      preferences: "Set job preferences",
      preferencesHint: "Say what you are looking for so matches fit.",
      preferencesDone: "Job preferences set",
      profile: "Complete your profile",
      profileHint: "A headline and a few skills help recruiters place you.",
      profileDone: "Profile details added",
      add: "Add",
    },
    stats: {
      activeApplications: "Active applications",
      activeApplicationsHint: "Still open with an employer.",
      savedJobs: "Saved jobs",
      savedJobsHint: "Your shortlist.",
      evidence: "Evidence sources",
      evidenceHint: "Files and links AI matching reads.",
      strongMatches: "Strong matches",
      strongMatchesHint: "Roles your evidence covers well.",
    },
    pipeline: {
      title: "Application pipeline",
      description: "Where your applications stand right now.",
      applied: "Applied",
      review: "In review",
      interview: "Interview",
      decision: "Decision",
      empty: "No applications yet",
      emptyHint: "Jobs you apply to appear here with their stage.",
      viewAll: "View all applications",
    },
    matches: {
      title: "Top AI matches",
      description: "Ranked from the evidence on your profile.",
      viewAll: "View all matches",
      view: "View match",
      sourceInternal: "HR Copilot",
      sourceExternal: "External",
      empty: "No matches yet",
      emptyHint:
        "Add a resume or a portfolio link, then run AI job matching.",
      unavailable: "Matches could not be loaded",
      unavailableHint: "Open AI Job Match to try again.",
      lockedHint:
        "AI job matching ranks every open role against your own evidence.",
      run: "Open AI Job Match",
      needsEvidence: "Add evidence first",
    },
    recent: {
      title: "Recent applications",
      viewAll: "View all",
    },
  },

  personal: {
    findJobs: "Find jobs",
    findJobsDescription:
      "Browse open roles and apply with the resume already on your profile.",
    findJobsUnavailable: "Job discovery is not open yet",
    findJobsUnavailableHint:
      "Vacancies currently live inside each recruiting organization and are only readable by that organization’s own team. There is no public listing to browse, and inventing one would show roles that nobody can actually apply to.",
    findJobsRequires: [
      "A public vacancy endpoint that returns only OPEN roles, with organization display name — never internal draft or archived postings",
      "A stable public identifier per vacancy so a job link can be shared outside the workspace",
    ],
    jobDetail: "Job detail",
    job: "Job",
    jobUnavailable: "This job cannot be shown publicly yet",
    jobUnavailableHint:
      "Reading a vacancy requires membership of the organization that posted it, so there is nothing a job seeker can open. The apply flow depends on the same contract.",
    jobRequires: [
      "A public vacancy detail endpoint exposing title, description, requirements, location and employment type only",
      "An endpoint that lets an authenticated job seeker apply to a vacancy for themselves",
    ],
    myApplications: "My applications",
    myApplicationsDescription:
      "Every role you have applied to, and where each one stands.",
    myApplicationsUnavailable:
      "Applications are tracked per organization, not per person",
    myApplicationsUnavailableHint:
      "An application currently points at a recruiter-owned candidate record inside one organization. Nothing links those records to the person who applied, so there is no way to look up “my” applications.",
    myApplicationsRequires: [
      "A CandidateAccount owned by the signed-in user",
      "A link from Application to that account, so a job seeker can read their own applications without belonging to the organization",
    ],
    stagesTitle: "How stages will read",
    stagesHint: "Recruiters own every transition — nothing here moves on its own.",
    myProfile: "My profile",
    myProfileDescription: "What recruiters see when you apply.",
    myProfileUnavailable: "There is no job-seeker profile to edit yet",
    myProfileUnavailableHint:
      "You are signed in as {email}, but that account only exists as a member of a recruiting organization. A job-seeker profile — headline, skills, experience, education, languages and a primary resume — has nowhere to be stored.",
    myProfileRequires: [
      "A CandidateAccount model owned by the user, separate from the recruiter-owned Candidate record",
      "Endpoints to read and update that profile as its owner",
      "A profile visibility setting, so a job seeker controls who can see them",
    ],
    savedJobs: "Saved jobs",
    savedJobsDescription: "Roles you want to come back to.",
    savedJobsUnavailable: "Saving jobs is not available yet",
    savedJobsUnavailableHint:
      "Saved roles need to belong to your account so they follow you across devices — and to the mobile app later. Keeping them in this browser’s storage would look like it works until you sign in somewhere else.",
    savedJobsRequires: [
      "A saved-jobs collection on the CandidateAccount",
      "Endpoints to save, list and remove a saved vacancy",
    ],
  },

  errors: {
    somethingWentWrong: "Something went wrong",
    pageLoadFailed: "This page could not be loaded. Retrying usually fixes it.",
    notFoundTitle: "Page not found",
    notFoundHint:
      "The page you were looking for is not part of {app}, or it has moved.",
    goToDashboard: "Go to dashboard",
    waitingOn: "Waiting on",
    validation: "Please check the highlighted fields and try again.",
    unauthorized: "Your session has expired. Sign in again to continue.",
    forbidden: "Your role does not allow this action.",
    notFound: "We could not find what you were looking for.",
    conflict: "That conflicts with something that already exists.",
    rateLimited: "Too many attempts. Wait a moment and try again.",
    server: "Something went wrong on our side. Try again shortly.",
    network: "Could not reach the server. Check your connection and try again.",
    unavailable: "This service is temporarily unavailable. Try again shortly.",
  },

  integrations: {
    groupEmail: "Email",
    groupEmailHint:
      "Pull applications that arrive as email attachments into the same processing pipeline as uploaded resumes.",
    groupJobBoards: "Job boards",
    groupJobBoardsHint:
      "Receive applicants from job boards so every source lands in one pipeline.",
    gmail: "Read applications from a shared recruiting inbox.",
    outlook: "Read applications from a Microsoft 365 recruiting inbox.",
    saramin: "Korean job board.",
    wanted: "Korean tech hiring platform.",
    jobkorea: "Korean job board.",
    jumpit: "Korean developer hiring platform.",
    linkedin:
      "Available only through LinkedIn’s partner programme — the product will not scrape or imitate private endpoints.",
    indeed: "Available only through Indeed’s partner programme, on the same terms.",
  },

  /** Shared table headers, filters and list-view copy. */
  tables: {
    documentsCount: {
      one: "{count} document",
      other: "{count} documents",
    } as Plural,
    vacancy: "Vacancy",
    candidate: "Candidate",
    department: "Department",
    location: "Location",
    type: "Type",
    status: "Status",
    candidates: "Candidates",
    created: "Created",
    experience: "Experience",
    documents: "Documents",
    processing: "Processing",
    updated: "Updated",
    empty: "—",
    locationNotSet: "Location not set",
    noVacancyAssigned: "No vacancy assigned",
    more: "+{count} more",
    yearsExperience: {
      one: "{count} year experience",
      other: "{count} years experience",
    } as Plural,
    searchVacancies: "Search title, department or location",
    searchVacanciesLabel: "Search vacancies",
    searchCandidates: "Search name, title, location or skill",
    searchCandidatesLabel: "Search candidates",
    filterByStatus: "Filter by status",
    filterByDepartment: "Filter by department",
    filterByVacancy: "Filter by vacancy",
    filterByProcessing: "Filter by processing state",
    sortCandidates: "Sort candidates",
    allProcessingStates: "All processing states",
    noDocumentsFilter: "No documents",
    noneUploaded: "None uploaded",
    captionVacancies: "Vacancies",
    captionCandidates: "Candidates",
    sortNameAZ: "Name (A–Z)",
    sortExperienceYears: "Years of experience",
    vacanciesEmptyHint:
      "Create a vacancy to define the requirements the copilot looks for in each resume.",
    vacanciesNoMatchHint: "Adjust the search or filters to widen the results.",
    candidatesEmptyHint:
      "Upload resumes from a vacancy or the processing queue to build your pipeline.",
    candidatesNoMatchHint: "Try a broader search, or clear one of the filters.",
    yearsShort: {
      one: "{count} yr",
      other: "{count} yrs",
    } as Plural,
  },

  vacancyForm: {
    roleTitle: "Role",
    roleHint: "How the vacancy is listed.",
    title: "Title",
    titlePlaceholder: "Senior Backend Engineer",
    department: "Department",
    departmentPlaceholder: "Engineering",
    location: "Location",
    locationPlaceholder: "Tashkent, Uzbekistan · Hybrid",
    employmentType: "Employment type",
    experienceLevel: "Experience level",
    descriptionTitle: "Job description",
    descriptionHint: "Pasted verbatim from your posting is fine.",
    description: "Description",
    descriptionPlaceholder:
      "What the team owns, what the person will do, who they work with…",
    requirementsTitle: "Requirements",
    requirementsHint:
      "Each row becomes an evidence check against every uploaded resume.",
    addRequirement: "Add requirement",
    requirementAria: "Requirement {index}",
    priorityAria: "Requirement {index} priority",
    typeAria: "Requirement {index} type",
    removeAria: "Remove requirement {index}",
    requirementsNote:
      "Keep labels short and checkable — “Kubernetes” or “3+ years backend experience” read better in the evidence table than a full paragraph.",
    saveDraft: "Save as draft",
    publish: "Publish vacancy",
    errTitle: "Vacancy title is required.",
    errDepartment: "Department is required.",
    errLocation: "Location is required.",
    errDescription: "Describe the role so requirements have context.",
    errRequirements:
      "Add at least one requirement — this is what each resume is checked against.",
    examples: [
      "NestJS",
      "Redis",
      "Kubernetes",
      "3+ years backend experience",
    ],
    // -- Structured sections ------------------------------------------------
    compensationHint: "Leave blank if pay is not advertised. Nothing is guessed from the description.",
    salaryMin: "Salary minimum",
    salaryMax: "Salary maximum",
    currency: "Currency",
    payPeriod: "Pay period",
    salaryNegotiable: "Salary is negotiable",
    errSalaryRange: "The maximum must be at least the minimum.",
    errCurrencyRequired: "Choose a currency for the salary range.",
    locationSectionHint: "Structured location. The free-text field above still shows on older postings.",
    countryLabel: "Country",
    regionLabel: "Region / state",
    regionPlaceholder: "Tashkent Region",
    cityLabel: "City",
    cityPlaceholder: "Seoul",
    officeDaysHint: "0–7 days in the office each week.",
    errOfficeDays: "Office days must be between 0 and 7.",
    remoteCountriesHint: "Countries this remote role can be done from.",
    choose: "Choose…",
    visaSectionHint: "State only what the employer has actually decided.",
    citizenshipHint: "Only when the role is genuinely restricted by law or contract.",
    errNationalitiesRequired: "Add at least one nationality, or remove the restriction.",
    experienceSectionHint: "Whole years. Leave blank if the role does not set a bar.",
    errExperienceRange: "Preferred experience cannot be below the minimum.",
    educationSectionHint: "Split required from preferred so evidence can be judged separately.",
    domainExperienceHint: "Industries or problem domains, e.g. fintech or logistics.",
    languagesHint: "One row per language. Levels are CEFR.",
    addLanguage: "Add language",
    noLanguages: "No language requirements.",
    languageAria: "Language {index}",
    languageLevelAria: "Language {index} level",
    languagePriorityAria: "Language {index} priority",
    removeLanguageAria: "Remove language {index}",
    errDuplicateLanguage: "Each language can appear only once.",
    errLanguageIncomplete: "Choose a language for every row, or remove the empty rows.",
    benefitsHint: "What the company actually offers.",
    benefitsOther: "Other benefit",
    timelineHint: "A deadline before the start date is normal.",
    startDateHint: "When the person would begin.",
    contractDurationHint: "Months. Leave blank for a permanent role.",
    errOpenings: "Openings must be at least 1.",
    errContractDuration: "Contract duration must be at least 1 month.",
    // -- Edit mode ----------------------------------------------------------
    editTitle: "Edit vacancy",
    editHint: "Changes apply to this posting immediately.",
    saveChanges: "Save changes",
    saved: "Vacancy updated.",
    notOwner: "This vacancy was created by a colleague. Only its creator can edit it.",
    editRequirementsNote:
      "Requirements are managed on the vacancy page and are not changed here.",
  },

  candidateForm: {
    candidateTitle: "Candidate",
    candidateHint: "Only the name is required — the rest can come from their resume.",
    vacancyTitle: "Vacancy",
    vacancyHint:
      "Attaching a vacancy is what gives the requirement checks something to compare against.",
    applyToVacancy: "Apply to vacancy",
    noVacancy: "No vacancy for now",
    errVacancyRequired: "Select one of your vacancies to add this candidate to.",
  },

  /**
   * Re-application vocabulary, shared by every HR surface that shows it.
   *
   * A candidate may apply to one vacancy several times, so both the vacancy
   * applicant list and Candidate Detail speak about attempts — in the same
   * words, from one place, because two copies would drift.
   */
  attempts: {
    count: {
      one: "{count} application",
      other: "{count} applications",
    } as Plural,
    label: "Attempt {number}",
    current: "Current",
    history: "Previous attempt history",
    viewHistory: "View history",
    hideHistory: "Hide history",
  },

  vacancyDetail: {
    breadcrumbNew: "New",
    jobDescription: "Job description",
    noDescription: "No description was added for this vacancy.",
    requirements: "Requirements",
    requirementsSplit: "{must} must have · {nice} nice to have",
    noRequirements: "No requirements yet",
    noRequirementsHint:
      "Requirements are what each uploaded resume is checked against. Without them there is nothing to find evidence for.",
    candidatesAttached: {
      one: "{count} candidate attached to this vacancy",
      other: "{count} candidates attached to this vacancy",
    } as Plural,
    noCandidates: "No applicants yet",
    noCandidatesHint:
      "Candidates who apply to this vacancy will appear here, and each resume is checked against the requirements above.",
    atAGlance: "At a glance",
    lastUpdated: "Last updated",
    readingResumes: "Reading resumes",
    readingResumesHint:
      "Applicants submit their own resume when they apply. Each submission is read and checked against the requirements above — nothing is uploaded on their behalf.",
    created: "Created {date}",
    deletedOrWrongLink: "This vacancy may have been deleted, or the link is wrong.",
    candidateRemovedOrWrongLink:
      "This candidate may have been removed, or the link is wrong.",
    newVacancyTitle: "Create vacancy",
    newVacancyHint:
      "Requirements you add here are what every uploaded resume gets checked against.",
    scopedSearchLabel: "Search this vacancy's candidates",
    scopedSearchPlaceholder:
      "Ask in plain language — e.g. who has run Kubernetes in production?",
    scopedSearchNote:
      "Results show the passage each match came from, with its document and page. No candidate is scored or ranked by the model.",
  },

  uploader: {
    dragOrBrowse: "Drag resumes here, or browse",
    sizeHint: "PDF or DOCX, up to {size} each. Multiple files supported.",
    selectFiles: "Select files",
    uploading: "Uploading",
    skipped: {
      one: "{count} file skipped",
      other: "{count} files skipped",
    } as Plural,
    pipeline: "Pipeline",
    indexedOf: "{done} of {total} indexed",
    failedSuffix: " · {count} failed",
    removeFromList: "Remove {name} from the list",
    clearList: "Clear list",
    hideUploader: "Hide uploader",
    uploadResumes: "Upload resumes",
    progressLabel: "{name} progress",
  },

  /**
   * Employment type and experience level are free text on the API. The stored
   * value stays canonical English so one organization's data does not fragment
   * by whichever language each recruiter happened to be using; only the label
   * shown in the picker is translated.
   */
  employmentType: {
    "Full-time": "Full-time",
    "Part-time": "Part-time",
    Contract: "Contract",
    Internship: "Internship",
    Temporary: "Temporary",
  },

  experienceLevel: {
    Intern: "Intern",
    Junior: "Junior",
    "Mid-level": "Mid-level",
    Senior: "Senior",
    Lead: "Lead",
    Principal: "Principal",
  },

  /* ---------------------------------------------------------------------- */
  /* Structured job vocabulary                                              */
  /*                                                                        */
  /* Backend enum values are the keys; only the LABEL is translated. The     */
  /* stored value stays canonical so one organization's records cannot       */
  /* fragment by whichever language each recruiter was using.                */
  /* ---------------------------------------------------------------------- */

  payPeriod: {
    HOURLY: "Hourly",
    MONTHLY: "Monthly",
    YEARLY: "Yearly",
  },

  workMode: {
    ONSITE: "On-site",
    HYBRID: "Hybrid",
    REMOTE: "Remote",
  },

  visaSponsorship: {
    YES: "Available",
    NO: "Not available",
    UNKNOWN: "Not specified",
  },

  citizenshipRequirement: {
    NONE: "No citizenship restriction",
    SPECIFIC: "Restricted to specific nationalities",
  },

  seniorityLevel: {
    INTERN: "Intern",
    JUNIOR: "Junior",
    MID: "Mid-level",
    SENIOR: "Senior",
    LEAD: "Lead",
    STAFF: "Staff",
    MANAGER: "Manager",
  },

  languageLevel: {
    A1: "A1 — Beginner",
    A2: "A2 — Elementary",
    B1: "B1 — Intermediate",
    B2: "B2 — Upper intermediate",
    C1: "C1 — Advanced",
    C2: "C2 — Proficient",
    NATIVE: "Native",
  },

  educationLevel: {
    HIGH_SCHOOL: "High school",
    ASSOCIATE: "Associate degree",
    BACHELOR: "Bachelor's degree",
    MASTER: "Master's degree",
    DOCTORATE: "Doctorate",
  },

  hiringUrgency: {
    LOW: "Low",
    NORMAL: "Normal",
    HIGH: "High",
  },

  benefit: {
    HEALTH_INSURANCE: "Health insurance",
    MEAL_ALLOWANCE: "Meal allowance",
    HOUSING_SUPPORT: "Housing support",
    RELOCATION_SUPPORT: "Relocation support",
    EDUCATION_BUDGET: "Education budget",
    REMOTE_ALLOWANCE: "Remote work allowance",
    FLEXIBLE_HOURS: "Flexible hours",
    STOCK_OPTIONS: "Stock options",
    BONUS: "Bonus",
    PAID_LEAVE: "Extra paid leave",
    OTHER: "Other",
  },

  /**
   * ISO 3166-1 alpha-2 → country name.
   *
   * A translated list rather than Intl.DisplayNames: Node's and the browser's
   * ICU tables disagree for several of these, and a server/client difference
   * is a hydration mismatch (see lib/i18n/format.ts). A code that is not
   * listed renders as the code itself, which is honest and stable.
   */
  country: {
    KR: "South Korea",
    UZ: "Uzbekistan",
    RU: "Russia",
    KZ: "Kazakhstan",
    US: "United States",
    GB: "United Kingdom",
    DE: "Germany",
    FR: "France",
    NL: "Netherlands",
    PL: "Poland",
    TR: "Türkiye",
    AE: "United Arab Emirates",
    SG: "Singapore",
    JP: "Japan",
    CN: "China",
    IN: "India",
    VN: "Vietnam",
    PH: "Philippines",
    ID: "Indonesia",
    MY: "Malaysia",
    TH: "Thailand",
    CA: "Canada",
    AU: "Australia",
    ES: "Spain",
    IT: "Italy",
  },

  /**
   * BCP-47 primary subtag → language name. Deliberately wider than the four
   * UI locales: the interface language and the job's language are different
   * questions.
   */
  jobLanguage: {
    en: "English",
    ko: "Korean",
    ru: "Russian",
    uz: "Uzbek",
    ja: "Japanese",
    zh: "Chinese",
    de: "German",
    fr: "French",
    es: "Spanish",
    it: "Italian",
    tr: "Turkish",
    ar: "Arabic",
    hi: "Hindi",
    pt: "Portuguese",
    kk: "Kazakh",
    vi: "Vietnamese",
    id: "Indonesian",
    th: "Thai",
  },

  /**
   * Normalized employment type. Reuses the Task 1 job vocabulary rather than
   * duplicating it: the same word must mean the same thing on a vacancy and in
   * a candidate's preferences.
   */
  employmentTypeValue: {
    FULL_TIME: "Full-time",
    PART_TIME: "Part-time",
    CONTRACT: "Contract",
    INTERNSHIP: "Internship",
    TEMPORARY: "Temporary",
  },

  jobPreferences: {
    title: "Job preferences",
    description:
      "What you are looking for. Used to find and rank jobs for you — it is never shown to employers as part of an application.",
    navLabel: "Job preferences",

    /* Primary dimensions */
    rolesTitle: "Roles",
    rolesHint:
      "Job titles you want, not skills. “DevOps Engineer”, not “Kubernetes”.",
    rolesPlaceholder: "DevOps Engineer",

    locationsTitle: "Locations",
    locationsHint:
      "Where you want to work. Pick a country, then narrow it down if you like.",
    addLocation: "Add location",
    country: "Country",
    region: "Region / state",
    city: "City",
    removeLocation: "Remove location {index}",
    noLocations: "No locations added.",

    workModeTitle: "Work arrangement",
    workModeHint: "Choose any that suit you. Choosing none means no preference.",

    compensationTitle: "Compensation",
    compensationHint:
      "The minimum you would consider. Leave blank if you would rather not say.",
    salaryMin: "Minimum salary",
    currency: "Currency",
    payPeriod: "Per",

    employmentTitle: "Employment type",
    employmentHint: "The kinds of contract you would accept.",

    seniorityTitle: "Experience level",
    seniorityHint:
      "The levels you want to be considered for — not a claim about your experience.",

    /* Secondary */
    additionalTitle: "Additional preferences",
    relocationTitle: "Relocation",
    relocationHint: "Would you move for the right role?",
    relocationLabel: "Willing to relocate",

    industriesTitle: "Industries",
    industriesHint: "Fields you would like to work in.",
    industriesPlaceholder: "Fintech",

    benefitsTitle: "Benefits",
    benefitsHint: "What matters to you beyond pay.",

    exclusionsTitle: "Exclusions",
    exclusionsHint:
      "Things you never want to see. Only what you enter here — nothing is learned from what you skip.",
    excludedCompanies: "Companies to exclude",
    excludedCompaniesPlaceholder: "Company X",
    excludedJobTitles: "Job titles to exclude",
    excludedJobTitlesPlaceholder: "PHP Developer",
    excludedLocations: "Locations to exclude",

    /* State */
    notStated: "Not stated",
    noPreference: "No preference",
    unknown: "Not stated",
    save: "Save preferences",
    saved: "Preferences saved.",
    clearAll: "Clear all preferences",
    clearAllConfirm:
      "This removes every preference you have stated. Your profile, documents and applications are not affected.",
    cleared: "Preferences cleared.",
    empty:
      "You have not set any job preferences yet. Nothing is guessed from your CV — only what you enter here counts.",
    lastUpdated: "Last updated {date}",

    /* Errors */
    errSalaryAmount: "Enter a whole number above zero, or leave it blank.",
    errSalaryCurrency: "Choose a currency for the amount.",
    errSalaryPeriod: "Choose a period for the amount.",
    errSalaryAmountMissing: "Enter an amount, or clear the currency and period.",
    errLocationCountry: "Choose a country for every location.",
    saveFailed: "Could not save your preferences. Try again.",
      salaryMax: "Maximum (optional)",
    salaryMaxHint: "The top of the range you have in mind. Jobs paying more than this are still shown — it is a target, not a limit.",
    errSalaryRange: "The maximum must be at least the minimum.",
},

  jobProfile: {
    /** Sections, shared by the HR detail page and the candidate job page. */
    compensation: "Compensation",
    locationWork: "Location & work arrangement",
    workAuthorization: "Work authorization",
    experience: "Experience & seniority",
    education: "Education & certifications",
    languages: "Languages",
    benefits: "Benefits",
    timeline: "Hiring timeline",

    notSpecified: "Not specified",
    negotiable: "Negotiable",
    required: "Required",
    preferred: "Preferred",
    yes: "Yes",
    no: "No",

    salary: "Salary",
    salaryRange: "{min} – {max}",
    salaryFrom: "From {min}",
    salaryUpTo: "Up to {max}",
    perPeriod: "{amount} / {period}",

    location: "Location",
    workModeLabel: "Work mode",
    officeDays: "Office days",
    officeDaysValue: "{count} per week",
    remoteCountries: "Open to candidates in",

    foreignApplicants: "Foreign applicants",
    visaSponsorshipLabel: "Visa sponsorship",
    existingWorkAuth: "Existing work authorization",
    existingWorkAuthRequired: "Required",
    existingWorkAuthNotRequired: "Not required",
    eligibleVisas: "Eligible visa types",
    citizenship: "Citizenship",
    eligibleNationalities: "Eligible nationalities",
    visaDisclaimer:
      "Stated by the employer. It is not legal advice and does not guarantee eligibility.",

    seniority: "Seniority",
    minExperience: "Minimum experience",
    preferredExperience: "Preferred experience",
    yearsValue: "{count} years",

    requiredEducation: "Required education",
    preferredEducation: "Preferred education",
    requiredCertifications: "Required certifications",
    preferredCertifications: "Preferred certifications",
    domainExperience: "Domain experience",

    deadline: "Apply by",
    expectedStart: "Expected start",
    openings: "Openings",
    urgency: "Hiring urgency",
    contractDuration: "Contract duration",
    monthsValue: "{count} months",
  },


  workspaces: {
    title: "Choose a workspace",
    description:
      "You are signed in once. Each workspace has its own data and its own role.",
    organizations: "Organizations",
    noOrganizations: "You do not belong to any organization yet.",
    noOrganizationsHint:
      "An organization owner or HR admin can add you to theirs. Until then, there is no organization workspace to open.",
    current: "Current",
    open: "Open",
    switching: "Switching workspace…",
    switchFailed: "Could not switch workspace.",
    switchedTo: "Now in {name}",
    membershipRevoked: "Your access to this workspace was removed",
    membershipRevokedHint:
      "Pick another workspace to continue. If this looks wrong, ask an administrator of that organization.",
  },

  /**
   * Professional links — the candidate-facing half of the evidence feature.
   *
   * Failure copy is written for a person, not an operator: it says what
   * happened to THEIR link and what they can do, and never quotes an HTTP
   * status, a hostname or an internal reason.
   */
  candidateLinks: {
    title: "Professional links",
    hint: "Up to {limit} public links — a portfolio, a repository, a project page. They are analysed the same way as your files.",
    empty: "No links yet.",
    add: "Add link",
    remove: "Remove",
    retry: "Try again",
    refresh: "Refresh analysis",
    urlLabel: "Link",
    urlPlaceholder: "https://your-portfolio.com",
    labelLabel: "Label (optional)",
    labelPlaceholder: "My portfolio",
    slots: "{count} of {limit} links used",
    analysedOn: "Analysed on {date}",
    limitReached:
      "You have used all your link slots. Remove one to add another. Your files are counted separately.",
    privacyNote:
      "Saved links are private to your profile. When you apply, a copy of what was read is sent with that application. Editing a link never rewrites what you already sent — but deleting one removes it from those applications too.",
    addFailed: "This link could not be added.",
    removeFailed: "This link could not be removed.",
    retryFailed: "This link could not be analysed again.",
    confirmDeleteTitle: "Delete this professional link?",
    confirmDeleteQuestion: "“{name}” will be removed from your profile.",
    confirmDeleteConsequence:
      "This evidence is also removed from applications you have already sent, and from the AI analysis recruiters see. The applications themselves stay.",
    errorCodes: {
      LINK_LIMIT_REACHED:
        "You can save up to 3 professional links. Remove one to add another.",
      LINK_DUPLICATE: "You have already added this link.",
      LINK_INVALID_URL:
        "That does not look like a public web address. Check it and try again.",
      LINK_NOT_RETRYABLE:
        "This link cannot be analysed again. Edit the address or remove it.",
      LINK_BUSY: "This link is already being analysed.",
    },
    failureCodes: {
      INVALID_URL: "That address could not be read. Check it and try again.",
      UNSUPPORTED_PROTOCOL:
        "Only public web addresses starting with http:// or https:// can be used.",
      PRIVATE_NETWORK_URL:
        "That address is not reachable from the public internet, so it cannot be used here.",
      FETCH_TIMEOUT: "The site took too long to respond. You can try again.",
      TOO_MANY_REDIRECTS:
        "That address kept redirecting. Try the direct link to the page.",
      CONTENT_TOO_LARGE:
        "That page is too large to analyse. Try linking to a specific page instead.",
      UNSUPPORTED_CONTENT_TYPE:
        "That link points at a file type we cannot read. Upload files in the files section instead.",
      ACCESS_DENIED:
        "That page is not publicly accessible — it may need a sign-in, or it may no longer exist.",
      NO_MEANINGFUL_CONTENT:
        "No readable text was found on that page. If it needs JavaScript to show its content, try linking to a page with text on it.",
      RENDER_FAILED: "That page could not be opened. You can try again.",
      UPSTREAM_ERROR: "The site returned an error. You can try again.",
      INDEXING_FAILED:
        "The page was read but could not be prepared for analysis. You can try again.",
    },
  },

  candidateProfile: {
    title: "My profile",
    description: "What a hiring team sees when you apply.",
    createTitle: "Create your job-seeker profile",
    createHint:
      "A profile is separate from any organization you work for. It is yours, and you decide what it says.",
    create: "Create profile",
    notCreated: "You have not created a job-seeker profile yet",
    basics: "Basics",
    basicsHint: "The header of your profile.",
    headline: "Headline",
    headlinePlaceholder: "Backend Engineer",
    location: "Location",
    phone: "Phone",
    summary: "Summary",
    summaryPlaceholder: "A few sentences about the work you do.",
    skills: "Skills",
    skillsHint: "Press Enter to add each one.",
    languages: "Languages",
    experience: "Experience",
    experienceHint: "Most recent first. Dates are free text — “2021”, “2021-03”.",
    addExperience: "Add a role",
    removeExperience: "Remove role {index}",
    jobTitle: "Title",
    company: "Company",
    startDate: "From",
    endDate: "To",
    roleDescription: "What you did",
    education: "Education",
    addEducation: "Add education",
    removeEducation: "Remove education {index}",
    institution: "Institution",
    degree: "Degree",
    field: "Field of study",
    startYear: "From year",
    endYear: "To year",
    visibility: "Profile visibility",
    visibilityHint:
      "Private means only the organizations you apply to can see what you send them.",
    visibilityPrivate: "Private",
    visibilityPublic: "Public",
    resume: "Resume",
    documents: "Resume documents",
    resumeHint:
      "PDF or DOCX, up to {size}. The newest upload becomes the resume used for future applications.",
    noResume: "No resume uploaded yet",
    uploadResume: "Upload resume",
    addDocument: "Add document",
    replaceResume: "Replace resume",
    uploading: "Uploading",
    downloadResume: "Open resume",
    deleteDocument: "Delete",
    primaryResume: "Primary",
    documentSlots: "{count} of {limit} documents used",
    documentLimitReached:
      "You have reached the 3-document limit. Delete one document to upload another.",
    uploadedOn: "Uploaded {date}",
    /**
     * The honest description of where a personal resume lives. It is not
     * indexed for any organization until an application copies it.
     */
    personalResumeNote:
      "Your resume stays private to you. When you apply, a copy is sent to that organization — and only to that one.",
    errTitleRequired: "A role needs a title.",
    errInstitutionRequired: "An education entry needs an institution.",
    saveFailed: "Could not save your profile.",
    createFailed: "Could not create your profile.",
    resumeUploadFailed: "Could not upload that file.",
    documentDeleteFailed: "Could not delete that document.",
    retryDocument: "Try again",
    documentRetryFailed: "Could not retry that document.",
    confirmDeleteTitle: "Delete this document?",
    confirmDeleteQuestion: "“{name}” will be deleted permanently.",
    confirmDeleteConsequence:
      "This evidence is also removed from applications you have already sent, and from the AI analysis recruiters see. The applications themselves stay.",
  },

  jobs: {
    title: "Find jobs",
    description: "Open roles you can apply to with the resume on your profile.",
    searchPlaceholder: "Search job titles and descriptions",
    searchLabel: "Search jobs",
    locationPlaceholder: "Location",
    locationLabel: "Filter by location",
    submit: "Search",
    clear: "Clear filters",
    resultCount: {
      one: "{count} open role",
      other: "{count} open roles",
    } as Plural,
    empty: "No open roles right now",
    emptyHint: "New roles appear here as organizations publish them.",
    noMatches: "No roles match that search",
    noMatchesHint: "Try fewer words, or clear the location filter.",
    postedOn: "Posted {date}",
    applicantCount: {
      one: "{count} applicant",
      other: "{count} applicants",
    } as Plural,
    rankNote:
      "Work arrangement, employment type, experience and pay rank the closest jobs first — nothing is hidden.",
    locationFilterNote: "Choosing a location narrows these results.",
    currencyNeeded: "Choose a currency to compare pay across countries.",
    save: "Save",
    saved: "Saved",
    unsave: "Remove from saved",
    aboutRole: "About this role",
    noDescription: "This role has no description.",
    requirements: "What they are looking for",
    mustHave: "Must have",
    niceToHave: "Nice to have",
    apply: "Apply",
    applyAgain: "Apply again",
    previousAttemptRejected:
      "Your previous application to this role was not selected. You can apply again — the earlier attempt stays in your history.",
    applying: "Applying",
    applied: "Applied",
    appliedHint: "You have applied to this role. Track it under My applications.",
    applySucceeded: "Application sent",
    applySucceededHint:
      "A copy of your resume went to {organization}. They will read it and decide — nothing is scored automatically.",
    viewApplications: "View my applications",
    notFound: "This job is no longer open",
    notFoundHint:
      "It may have been filled or closed. Browse the open roles instead.",
    backToJobs: "Back to jobs",
    needsProfile: "Create your profile first",
    needsProfileHint:
      "Applying sends your profile and resume, so both need to exist first.",
    goToProfile: "Go to my profile",
    needsResume: "Upload a resume first",
    needsResumeHint:
      "An application carries a copy of your resume, so there needs to be one to send.",
    alreadyApplied: "You have already applied",
    alreadyAppliedHint:
      "One application per role. Withdrawing does not free it up again — the hiring team can still move yours forward.",
    jobUnavailable: "This role is no longer accepting applications",
      filtersTitle: "Filters",
    moreFilters: "More filters",
    fewerFilters: "Fewer filters",
    countryLabel: "Country",
    workModeLabel: "Work arrangement",
    employmentLabel: "Employment type",
    seniorityLabel: "Experience level",
    salaryLabel: "Minimum salary",
    salaryAmountPlaceholder: "Amount",
    anyOption: "Any",
    applyFilters: "Search",
    usingPreferences: "Using your saved job preferences. Anything you change here applies to this search only.",
    editPreferences: "Edit preferences",
    salaryUnknownKept: "Salary not stated — shown anyway",
    salaryNotComparableKept: "Salary could not be compared — shown anyway",
},

  applications: {
    title: "My applications",
    description: "Every role you applied to, and where each one stands.",
    empty: "No applications yet",
    emptyHint: "Roles you apply to appear here with their current stage.",
    appliedOn: "Applied {date}",
    updatedOn: "Updated {date}",
    withdraw: "Withdraw",
    withdrawing: "Withdrawing",
    withdrawn: "Application withdrawn",
    withdrawFailed: "Could not withdraw that application.",
    cannotWithdraw: "This application can no longer be withdrawn",
    cannotWithdrawHint:
      "Its stage is final. The hiring team is the only side that can change it now.",
    stageNote:
      "Stages are set by the hiring team. The only change you can make is withdrawing.",
  },

  chat: {
    title: "Interview chats",
    messages: "Messages",
    hrDescription:
      "Vacancy-scoped conversations with candidates who have been invited to interview.",
    candidateDescription:
      "Interview conversations for vacancies where the hiring team invited you.",
    conversations: "Conversations",
    conversationsHint: "Only interview invitations with chat access appear here.",
    noConversations: "No conversations",
    noConversationsHint:
      "Chats appear after an interview invitation unlocks a platform conversation.",
    selectConversation: "Select a conversation",
    selectConversationHint: "Choose an interview chat from the list.",
    loadingMessages: "Loading messages",
    emptyConversation: "No messages yet",
    emptyConversationHint: "Start with a short interview coordination note.",
    inviteToInterview: "Invite to interview",
    reject: "Reject",
    openChat: "Open chat",
    send: "Send",
    typeMessage: "Type a message",
    you: "You",
    viewVacancy: "View vacancy",
    viewJob: "View job",
    chatUnavailable: "Chat unavailable",
    candidateRejectedNotice:
      "The candidate was rejected and the interview chat was deleted.",
    vacancyClosedNotice:
      "This vacancy was closed and the interview chat was deleted.",
    chatDeleted: "This interview chat was deleted.",
    connected: "Connected",
    connecting: "Connecting",
    reconnecting: "Reconnecting",
    loadFailed: "Could not load this conversation.",
    sendFailed: "Could not send the message.",
    closeVacancy: "Close vacancy",
    closeVacancyFailed: "Could not close this vacancy.",
    closeVacancyQuestion: "Are you sure you want to close this vacancy?",
    areYouSure: "Are you sure?",
    allChatsDeleted:
      "All interview chats for this vacancy will be permanently deleted.",
    yes: "Yes",
    no: "No",
  },

  savedJobs: {
    title: "Saved jobs",
    description: "Roles you kept to come back to.",
    empty: "Nothing saved yet",
    emptyHint: "Save a role from the job board and it waits for you here.",
    savedOn: "Saved {date}",
    remove: "Remove",
    closed: "No longer open",
    closedHint: "This role closed after you saved it, so it cannot be applied to.",
    viewJob: "View role",
  },

  sessions: {
    title: "Signed-in devices",
    description:
      "Every browser or device with a live session. Signing one out takes effect immediately.",
    thisDevice: "This device",
    unknownDevice: "Unknown device",
    created: "Signed in {date}",
    lastUsed: "Last used {date}",
    expires: "Expires {date}",
    signOut: "Sign out",
    signOutTitle: "Sign out {device}",
    signingOut: "Signing out",
    signOutEverywhere: "Sign out everywhere",
    signOutEverywhereHint:
      "Ends every session including this one. Use it if a device was lost.",
    revokeFailed: "Could not sign that session out.",
    empty: "No other devices are signed in.",
    unavailable: "Sessions could not be loaded",
    unavailableHint: "Try again shortly — your current session is unaffected.",
  },

  authErrors: {
    AUTH_INVALID_REFRESH_TOKEN: "Your session is no longer valid. Sign in again.",
    AUTH_REFRESH_TOKEN_EXPIRED: "Your session has expired. Sign in again.",
    AUTH_REFRESH_TOKEN_REUSED:
      "Your session was ended for safety because its credentials were used twice. Sign in again.",
    AUTH_SESSION_REVOKED: "This session was signed out. Sign in again.",
    AUTH_SESSION_NOT_FOUND: "This session no longer exists. Sign in again.",
    generic: "Your session has ended. Sign in again.",
  },

  jobMatch: {
    selectToPreview: "Select a match",
    selectToPreviewHint: "The full match, its evidence and the AI explanation appear here.",
    title: "AI Job Match",
    description:
      "Find open roles that match your profile and resume, with the evidence behind each match.",
    introTitle: "Which jobs fit me?",
    introHint:
      "Matching compares your own profile and resume against open roles and shows what each requirement is backed by. It takes around twenty seconds.",
    run: "Find my matches",
    refresh: "Refresh matches",
    clearResults: "Clear results",
    matchCount: {
      one: "{count} matched role",
      other: "{count} matched roles",
    } as Plural,
    loadingStages: [
      "Analyzing your profile and resume…",
      "Finding relevant open roles…",
      "Comparing job requirements…",
      "Preparing grounded explanations…",
    ],
    loadMore: "Show more matches",
    loadingMore: "Loading…",
    showingCount: "showing {shown} of {total}",
    refreshing: "Refreshing…",
    refreshingHint:
      "Refreshing matches in the background. Your current results stay visible.",
    refreshFailed:
      "Could not refresh matches. Your previous results are still shown.",
    strength: {
      STRONG: "Strong match",
      PARTIAL: "Partial match",
      WEAK: "Weak match",
    },
    coverageNote:
      "Match labels reflect how much of each role's requirements your documents support. They are not a score of you and not an application recommendation.",
    explanationPending:
      "Writing the explanation for this match. The evidence below is already complete.",
    explanationUnavailable:
      "The AI explanation is temporarily unavailable. The match evidence below is still complete.",
    requirementSummary: "Requirement summary",
    supported: "What I match",
    missing: "What I am missing",
    unclear: "What is unclear",
    noneInGroup: "No items reported in this group.",
    required: "required",
    viewEvidence: "View evidence",
    viewJob: "View job",
    needProfileTitle: "Create your profile first",
    needProfileHint:
      "Job matching works from your own profile and resume. Create your candidate profile to get started.",
    notReadyTitle: "Add evidence to use AI Job Match",
    notReadyHint:
      "Matching reads your files and your professional links. Upload a resume or add a link so it has real evidence to work with — a profile on its own is not evidence.",
    completeProfile: "Complete profile",
    goToProfile: "Go to my profile",
    staleNotice:
      "Your evidence changed. Refresh matches to analyse your current profile.",
    resumeImprovesWithLinks:
      "Add a resume for stronger matching. Your professional links are already being analysed.",
    resumeImproves:
      "A resume improves match quality: requirements are checked against your actual documents.",
    uploadResume: "Upload resume",
    noMatches: "No matching roles right now",
    noMatchesHint:
      "None of the currently open roles matched your profile. New roles are matched as they open — check back later.",
    unavailable: "Matching is temporarily unavailable",
    unavailableHint:
      "The matching service is not reachable right now. Nothing was computed — try again shortly.",
      scoreLabel: "Match score",
    scoreValue: "{score} / 100",
    band: {
      STRONG: "Strong match",
      GOOD: "Good match",
      PARTIAL: "Partial match",
      LOW: "Low match",
    },
    topReasons: "Top reasons",
    whyMatches: "Why this matches",
    whyNotHigher: "Why not higher",
    capabilitySection: "Capability",
    preferencesSection: "Preference alignment",
    salarySection: "Salary",
    approxSalary: "≈ {amount}",
    convertedNote: "Converted from what the employer stated, for comparison with your desired salary.",
    fxUpdated: "Exchange rates updated {ago}",
    fxUnavailable: "Exchange rate unavailable",
    noPreferences: "Set your job preferences to see how each role lines up with what you want.",
    excludedNote: {
      one: "{count} job hidden by your exclusions",
      other: "{count} jobs hidden by your exclusions",
    } as Plural,
    capabilityStrong: "Your evidence supports {count} of this role’s requirements",
    capabilityNone: "None of this role’s stated requirements were found in your evidence",
    capabilityMissing: "{count} requirements were not found in your evidence",
    capabilityUnclear: "{count} requirements need a human to look",
    skillsMatched: "Evidence for {skills}",
    matchReason: {
      ROLE_EXACT: "Matches your target role",
      ROLE_RELATED: "Closely related to your target role",
      ROLE_FAMILY_MATCH: "The kind of work you are looking for",
      ROLE_FAMILY_ADJACENT: "Related to the work you are looking for",
      ROLE_MISMATCH: "A different role from the ones you want",
      LOCATION_EXACT: "In the city you prefer",
      LOCATION_REGION_MATCH: "In the region you prefer",
      LOCATION_COUNTRY_MATCH: "In a country you prefer",
      LOCATION_REMOTE_ELIGIBLE: "Remote, and open to your preferred country",
      LOCATION_MISMATCH: "Location differs from your preferred location",
      LOCATION_UNKNOWN: "Location not specified by the employer",
      WORK_MODE_MATCH: "Work arrangement matches your preference",
      WORK_MODE_MISMATCH: "Work arrangement differs from your preference",
      WORK_MODE_UNKNOWN: "Work arrangement not specified by the employer",
      SALARY_WITHIN_DESIRED_RANGE: "Salary is within your desired range",
      SALARY_ABOVE_DESIRED_RANGE: "Salary is above your desired range",
      SALARY_PARTIAL_OVERLAP: "Salary partly overlaps your desired range",
      SALARY_MEETS_MINIMUM: "Salary meets your minimum",
      SALARY_BELOW_MINIMUM: "Salary is below your preferred minimum",
      SALARY_UNKNOWN: "Salary not provided by the employer",
      SALARY_NOT_COMPARABLE: "Salary could not be compared",
      EMPLOYMENT_MATCH: "Employment type matches your preference",
      EMPLOYMENT_MISMATCH: "Employment type differs from your preference",
      EMPLOYMENT_UNKNOWN: "Employment type not specified by the employer",
      SENIORITY_MATCH: "Experience level matches your preference",
      SENIORITY_ADJACENT: "Experience level is close to your preference",
      SENIORITY_MISMATCH: "Experience level differs from your preference",
      SENIORITY_UNKNOWN: "Experience level not specified by the employer",
      INDUSTRY_MATCH: "In an industry you prefer",
      INDUSTRY_MISMATCH: "Not in the industries you named",
      INDUSTRY_UNKNOWN: "Industry not specified by the employer",
      BENEFITS_MATCH: "Offers the benefits you named",
      BENEFITS_PARTIAL: "Offers some of the benefits you named",
      BENEFITS_MISMATCH: "Does not list the benefits you named",
      BENEFITS_UNKNOWN: "Benefits not listed by the employer",
    },
},
  vacancyScope: {
    selectorLabel: "My vacancy",
    myVacancies: "My vacancies",
    choosePlaceholder: "Select a vacancy",
    allVacancies: "All my vacancies",
    noneTitle: "No vacancies yet",
    noneHint: "Create a vacancy first — candidates, evidence and chats all live inside one.",
    invalidSelection: "Not one of your vacancies",
    selectFirstTitle: "Select one of your vacancies",
    selectFirstHint: "Pick a vacancy above to work inside it.",
    notOwned: "This vacancy was created by another member of your organization. You can only work inside vacancies you created.",
    notFound: "That vacancy is not available.",
    candidateNotInVacancy: "This candidate is not in the selected vacancy.",
    noCandidatesTitle: "No applicants yet",
    noCandidatesHint: "Candidates who apply to this vacancy will appear here.",
    scopedToVacancy: "For: {title}",
    select: "Select",
    selected: "Selected",
    ownedByOther: "Created by a colleague",
    deleteSelected: "Delete selected",
    deleteConfirmTitle: "Delete the selected vacancy?",
    deleteConfirmTitlePlural: "Delete the selected vacancies?",
    deleteConfirmHint: "This also removes their candidates' applications, evidence and interview chats.",
    yes: "Yes",
    no: "No",
    deleting: "Deleting",
    deleteFailed: "Nothing was deleted. The selection includes a vacancy you cannot delete.",
    deletedCount: {
      one: "{count} vacancy deleted",
      other: "{count} vacancies deleted",
    } as Plural,
    selectedCount: {
      one: "{count} selected",
      other: "{count} selected",
    } as Plural,
    selectAll: "Select all",
    clearSelection: "Clear selection",
    chatUnavailable: "Conversation unavailable",
    chatUnavailableHint: "It may have been removed, or it belongs to a vacancy you did not create.",
    accountRequired: "This candidate has no platform account, so interview chat is unavailable.",
  },
  status: {
    vacancy: {
      DRAFT: "Draft",
      OPEN: "Open",
      CLOSED: "Closed",
      ARCHIVED: "Archived",
    },
    document: {
      UPLOADED: "Uploaded",
      QUEUED: "Queued",
      PARSING: "Parsing",
      CHUNKING: "Chunking",
      EMBEDDING: "Embedding",
      INDEXING: "Indexing",
      COMPLETED: "Completed",
      FAILED: "Failed",
    },
    /** A professional link's lifecycle. Describes the fetch, never the person. */
    link: {
      PENDING: "Waiting",
      FETCHING: "Reading page",
      PROCESSING: "Analysing",
      COMPLETED: "Analysed",
      FAILED: "Could not read",
    },
    pipeline: {
      UPLOADED: "Uploaded",
      PARSING: "Parsing",
      CHUNKING: "Chunking",
      EMBEDDING: "Embedding",
      INDEXING: "Indexed",
      COMPLETED: "Completed",
    },
    job: {
      PENDING: "Pending",
      QUEUED: "Queued",
      RUNNING: "Running",
      COMPLETED: "Completed",
      FAILED: "Failed",
    },
    documentType: {
      RESUME: "Resume",
      PORTFOLIO: "Portfolio",
      JOB_DESCRIPTION: "Job description",
      HR_DOCUMENT: "HR document",
    },
    requirementType: {
      SKILL: "Skill",
      EXPERIENCE: "Experience",
      EDUCATION: "Education",
      LANGUAGE: "Language",
      OTHER: "Other",
    },
    application: {
      NEW: "New",
      REVIEWING: "Reviewing",
      INTERVIEW: "Interview",
      OFFER: "Offer",
      HIRED: "Hired",
      REJECTED: "Rejected",
      WITHDRAWN: "Withdrawn",
    },
    applicationSource: {
      DIRECT: "Direct",
      EMAIL: "Email",
      LINKEDIN: "LinkedIn",
      INDEED: "Indeed",
      SARAMIN: "Saramin",
      JOBKOREA: "JobKorea",
      WANTED: "Wanted",
      JUMPIT: "Jumpit",
      REFERRAL: "Referral",
      MANUAL_UPLOAD: "Manual upload",
    },
    role: {
      OWNER: "Owner",
      HR_ADMIN: "HR admin",
      RECRUITER: "Recruiter",
      INTERVIEWER: "Interviewer",
    },
    evidence: {
      FOUND: "Evidence found",
      NOT_FOUND: "No evidence found",
      NEEDS_REVIEW: "Needs human review",
      NOT_RUN: "Not mapped yet",
    },
    evidenceShort: {
      FOUND: "Found",
      NOT_FOUND: "Not found",
      NEEDS_REVIEW: "Review",
      NOT_RUN: "Not run",
    },
    answer: {
      GROUNDED: "Grounded",
      INSUFFICIENT_EVIDENCE: "Insufficient evidence",
      NEEDS_HUMAN_REVIEW: "Needs human review",
    },
    questionKind: {
      evidence_probe: "Evidence probe",
      missing_requirement_probe: "Missing requirement",
    },
    requirementPriority: {
      required: "Must have",
      optional: "Nice to have",
    },
    stream: {
      connecting: "Connecting",
      live: "Live",
      reconnecting: "Reconnecting",
      offline: "Not watching",
    },
    candidateStage: {
      NEW: "Submitted",
      REVIEWING: "Under review",
      INTERVIEW: "Interview",
      OFFER: "Offer",
      HIRED: "Hired",
      REJECTED: "Not selected",
      WITHDRAWN: "Withdrawn",
    },
    candidateStageHint: {
      NEW: "Your application has been received.",
      REVIEWING: "Someone on the hiring team is reading your application.",
      INTERVIEW: "You have reached the interview stage.",
      OFFER: "An offer is being prepared or has been sent.",
      HIRED: "You accepted the role.",
      REJECTED: "The team decided not to move forward.",
      WITHDRAWN: "You withdrew this application.",
    },
    integrationAvailability: {
      planned: "Not connected",
      requires_partner_approval: "Requires partner approval",
    },
  },

  /**
   * Roles published outside HR Copilot.
   *
   * The wording carries three promises the rest of the product cannot make on
   * this screen: applying happens on the employer's own site, the score is
   * about the search and not about the reader's chances, and anything the
   * employer did not state is written as unstated rather than filled in.
   */
  /**
   * The candidate's own record of applications made on employers' sites.
   *
   * Every string here is written so a reader cannot mistake it for something
   * this product observed. It never says "your application was received" —
   * it was not received here, and nobody here can tell them what happened to
   * it.
   */
  externalApplications: {
    tab: "My external applications",
    title: "My external applications",
    description:
      "Applications you made on employers' own sites. You keep this list up to date yourself — HR Copilot does not receive these applications and cannot check their progress.",
    managedByYou: "You keep this list up to date yourself.",
    notInternal:
      "Applications you made inside HR Copilot are under My applications.",
    goToInternal: "My applications",
    markApplied: "Mark as applied",
    markAppliedHint:
      "Opening the employer's site does not record anything. Mark it here once you have actually applied.",
    marking: "Saving…",
    markFailed: "Could not record this. Try again.",
    statusLabel: "Application status",
    updateStatus: "Update status",
    updateFailed: "Could not update the status. Try again.",
    removeTracking: "Remove tracking",
    removeTrackingHint:
      "Removes your own record. It does not withdraw anything from the employer.",
    removeFailed: "Could not remove tracking. Try again.",
    appliedOn: "Applied on {date}",
    filterAll: "All",
    clearStatusFilter: "Show all",
    emptyForStatus: "Nothing with this status.",
    emptyForStatusHint:
      "Change the status filter to see your other external applications.",
    listingGoneTitle: "Listing no longer available",
    listingGoneHint:
      "The posting is no longer in the catalogue. Your own record is kept.",
    listingStatusLabel: "Current listing status",
    listingActive: "Still listed",
    note: "Notes",
    notePlaceholder: "e.g. Recruiter contacted me · Technical interview Sep 4",
    saveNote: "Save note",
    noteSaved: "Note saved",
    empty: "No external applications tracked yet.",
    emptyHint:
      "When you apply on an employer's site, mark it here and it will appear in this list.",
    errorTitle: "This list could not be loaded",
    errorHint: "It is not reachable right now. Try again.",
    viewJob: "View job",
    openOriginal: "Open on employer's site",
    status: {
      APPLIED: "Applied",
      INTERVIEW: "Interview",
      OFFER: "Offer",
      REJECTED: "Rejected",
      WITHDRAWN: "Withdrawn",
    },
  },

  externalJobs: {
    title: "External jobs",
    description:
      "Roles published on other job boards and company career sites. You apply on the employer’s own site — HR Copilot does not receive these applications.",
    searchTab: "Search",
    whyMatchTitle: "Why this match?",
    whyMatchInvite: "Get a short written explanation of why this job was ranked where it was.",
    whyMatchGenerate: "Generate explanation",
    whyMatchStrengths: "Strengths",
    whyMatchGaps: "Potential gaps",
    aiToolsTitle: "AI tools",
    coverLetterTab: "Cover letter",
    coverLetterTitle: "Cover letter",
    coverLetterInvite:
      "Draft a cover letter for this job from your profile. You can copy it and edit it wherever you send it.",
    coverLetterGenerate: "Generate cover letter",
    coverLetterSubject: "Subject",
    coverLetterCopyLabel: "Copy the cover letter",
    interviewPrepTab: "Interview prep",
    interviewPrepTitle: "Interview prep",
    interviewPrepInvite:
      "Get likely interview questions for this job, why they may come up, and how to prepare.",
    interviewPrepGenerate: "Generate interview prep",
    interviewQuestions: "Likely interview questions",
    interviewFocusAreas: "Focus areas",
    matchBreakdownTab: "Match breakdown",
    matchBreakdownTitle: "Match breakdown",
    matchBreakdownInvite:
      "See how this job lines up with your profile, one area at a time — skills, location, pay and the rest.",
    matchBreakdownGenerate: "Generate breakdown",
    tabsLabel: "Where the job was published",

    searchLabel: "Search external jobs",
    searchPlaceholder: "Job title, skill or company",
    submit: "Search",
    filters: "Filters",
    filtersWithCount: "Filters ({count})",
    filtersTitle: "Filters",
    applyFilters: "Show results",
    reset: "Reset filters",
    resetHint:
      "Clears only what you chose here. Your saved job preferences are not changed.",
    close: "Close",
    moreFilters: "More filters",
    fewerFilters: "Fewer filters",

    countryLabel: "Country",
    filterTag: "Filter",
    preferenceTag: "Preference",
    countryHint: "Shows only jobs open in the countries you pick.",
    preferenceHint:
      "These rank the closest jobs first. Nothing is hidden by them.",
    workModeLabel: "Work arrangement",
    employmentLabel: "Employment type",
    seniorityLabel: "Experience level",
    salaryLabel: "Minimum salary",
    salaryAmountPlaceholder: "Amount",
    currencyLabel: "Currency",
    payPeriodLabel: "Per",
    anyOption: "Any",
    currencyNeeded:
      "Choose a currency and a period to compare pay across countries.",

    usingPreferences: "Results are personalized using your job preferences.",
    editPreferences: "Edit preferences",

    resultCount: {
      one: "{count} matching job",
      other: "{count} matching jobs",
    } as Plural,
    truncatedNote:
      "Showing the most relevant results. More jobs match these filters.",
    degradedNotice:
      "Meaning-based matching is temporarily unavailable. These results come from text matching only.",

    searching: "Searching external jobs…",
    searchingHint: "The first search after a quiet period can take a few seconds.",

    empty: "No external jobs match your search",
    emptyHint: "Try one of these:",
    emptyFewerWords: "Search a job title instead of a sentence",
    emptyClearCountry: "Remove the country filter",
    emptyClearAll: "Reset the filters",
    browseTitle: "Browse external jobs",
    browseHint:
      "Search by job title, or open the filters to narrow by country. Your saved preferences already shape the order.",

    errorTitle: "Could not search external jobs",
    errorHint: "Nothing was computed. Try again in a moment.",
    retry: "Try again",
    needsAccountTitle: "Create your profile first",
    needsAccountHint:
      "External job search uses your candidate profile to order results. Create one to get started.",
    goToProfile: "Go to my profile",

    scoreLabel: "Match",
    scoreValue: "{score} / 100",
    scoreNote:
      "How well this job answers your search and your preferences. It is not a chance of being hired.",
    band: {
      STRONG: "Strong match",
      GOOD: "Good match",
      PARTIAL: "Partial match",
      LOW: "Low match",
    },
    whyThis: "Why this result",

    locationUnknown: "Location not stated",
    alsoOpenIn: "Also open in",
    moreLocations: {
      one: "+{count} more location",
      other: "+{count} more locations",
    } as Plural,
    remoteStated: "Remote · open to {countries}",
    remoteUnstated: "Remote · countries not stated",
    remoteUnstatedHint:
      "The employer did not say which countries this remote role is open to.",

    salaryUnknown: "Salary not provided",
    salaryNote: "As posted by the employer.",

    staleNotice: "Listing may need re-verification",
    staleHint:
      "No source has re-listed this job recently. It may still be open — check the original posting.",
    // Saving. The control is a toggle, so the label states what the NEXT
    // press does — "Saved" alone would leave a reader guessing.
    save: "Save job",
    savedState: "Saved",
    unsave: "Remove from saved",
    saveFailed: "Could not save this job. Try again.",
    unsaveFailed: "Could not remove this job. Try again.",
    savedTab: "Saved",
    savedTitle: "Saved external jobs",
    savedDescription:
      "Jobs you kept from External jobs. You apply on the employer's own site.",
    savedEmpty: "No saved external jobs yet.",
    savedEmptyHint:
      "Save jobs while browsing External jobs and they will appear here.",
    savedPageEmpty: "Nothing on this page.",
    savedPageEmptyHint: "The rest are on the earlier pages.",
    savedFirstPage: "Go to the first page",
    savedErrorTitle: "Saved jobs could not be loaded",
    savedErrorHint: "The list is not reachable right now. Try again.",
    savedOn: "Saved {date}",
    browseExternal: "Browse external jobs",
    closedNotice: "Listing closed",
    expiredNotice: "Listing expired",
    unavailableNotice: "Listing unavailable",
    unexpectedStatus: "This listing may no longer be open",

    sourceLine: "Source: {source}",
    applyViaLine: "Apply via: {source}",
    sourceCountLine: "Listed by {count} sources",
    sourceUnknown: "External source",
    source: {
      GREENHOUSE: "Greenhouse",
      LEVER: "Lever",
      ASHBY: "Ashby",
      NINEHIRE: "Ninehire",
      COMPANY_CAREERS: "Company careers",
    },

    apply: "Apply on original site",
    applyHint:
      "Opens the employer’s site in a new tab. HR Copilot does not receive this application and cannot track it.",
    externalLink: "opens in a new tab",
    viewDetails: "View details",
    detailsTitle: "Job details",
    aboutRole: "About this role",
    requirements: "What they are looking for",
    noDescription:
      "This listing has no description here. Open the original posting to read it.",
    skills: "Skills",
    languages: "Languages",
    benefits: "Benefits",
    industries: "Industries",
    loadingDetail: "Loading job…",
    detailError: "Could not load this job.",
    detailGone: "This job is no longer listed.",
    companySite: "Company website",

    /**
     * External-search-only reason codes. Everything else — location, salary,
     * work mode, employment, seniority — is read from `jobMatch.matchReason`,
     * because the same verdict has to read the same way on both screens.
     */

    sortLabel: "Sort by",
    sortRelevance: "Relevance",
    sortNewest: "Newest",
    sortNewestNote:
      "Ordered by the date each employer published the listing. Jobs whose source states no date come last.",

    postedToday: "Posted today",
    postedYesterday: "Posted yesterday",
    postedDaysAgo: {
      one: "Posted {count} day ago",
      other: "Posted {count} days ago",
    } as Plural,
    postedOn: "Posted {date}",
    reason: {
      TEXT_STRONG_MATCH: "Strong match for what you searched",
      TEXT_TITLE_MATCH: "Matches what you searched",
      TEXT_PARTIAL_MATCH: "Partly matches what you searched",
      TEXT_SEMANTIC_MATCH: "Similar to what you searched for",
      STALE_LISTING: "Listing may need re-verification",
    },
  },

  /**
   * The two AI job searches, and what each one's Apply button means.
   *
   * `sourceName` and `applyMeaning` are a pair on purpose: naming the source
   * without saying what applying does would make the two universes look like a
   * filing distinction rather than two different promises.
   */
  aiJobSearch: {
    tabsLabel: "AI job search",
    internalTab: "Internal AI Jobs",
    externalTab: "External AI Jobs",
    lockedTabLabel: "{tab} — available on {plan}",
    internal: {
      sourceName: "HR Copilot Jobs",
      applyMeaning: "Apply inside HR Copilot",
    },
    external: {
      sourceName: "External Jobs",
      applyMeaning: "Apply on the original site",
    },
  },

  recruiterPlans: {
    title: "Plans for recruiters",
    description: "Recruiter AI sourcing plans are coming soon.",
    comingSoon: "Coming soon",
    previewNotice:
      "This page is a preview of where HR Copilot for recruiters is heading. Nothing here can be purchased yet, and no recruiter plan is active on your workspace.",
    currentlyIncluded: "Available today",
    planned: "Planned",
    pricingComingSoon: "Pricing coming soon",
    free: "$0",
    perMonth: "per month",
    tiers: {
      FREE: {
        name: "Free",
        tagline: "Everything your team uses in HR Copilot today.",
        features: [
          "Create and manage vacancies",
          "Receive and review applications",
          "Candidate evidence and AI search",
          "Interview chats and candidate comparison",
        ],
      },
      PRO: {
        name: "Pro",
        tagline: "Planned: find candidates beyond the people who applied.",
        features: [
          "External AI candidate search",
          "Vacancy-grounded candidate sourcing",
          "AI candidate ranking against one vacancy",
          "Source-aware candidate discovery",
          "Advanced candidate match explanations",
        ],
      },
      MAX: {
        name: "Max",
        tagline: "Planned: sourcing across several external sources at once.",
        features: [
          "Everything planned for Pro",
          "Multi-source AI sourcing",
          "Cross-source candidate discovery",
          "Advanced candidate comparison",
          "Sourcing insights",
          "Priority AI workflows",
        ],
      },
    },
    sourcing: {
      title: "AI candidate sourcing — coming soon",
      description:
        "The planned flow: pick one of your vacancies, and HR Copilot searches external sources for relevant profiles and ranks them against that vacancy.",
      steps: [
        "Select your vacancy",
        "HR Copilot AI",
        "Search planned external sources",
        "Rank relevant candidates",
        "Review evidence",
      ],
      sourcesTitle: "Planned sources",
      sourcesNote:
        "No source here can be searched yet. They describe the intended direction, not an existing feature.",
    },
    roadmap: {
      title: "More recruiter AI tools are coming.",
      description:
        "Future releases will expand AI-assisted sourcing and vacancy-based candidate discovery.",
    },
  },

  plans: {
    title: "Plans",
    description:
      "What each plan includes for your job search. Prices are shown per month.",
    names: { FREE: "Free", PRO: "Pro", MAX: "Max" },
    availableOn: "Available on {plan}.",
    upgradeTo: "Upgrade to {plan}",
    viewPlans: "View plans",
    priceMonthly: "${amount}/month",
    currentPlan: "Current plan",
    currentPlanIs: "You are on {plan}.",
    notReported: "Current plan not reported by the server.",
    noCheckoutNote:
      "Payment is not available yet, so nothing can be purchased from this page. It is here so you can see what each plan includes.",
    planOptions: "Plan options",
    planOptionsDescription:
      "Paid upgrades open checkout. Your current plan changes only after the backend reports the new state.",
    capabilities: "Capabilities",
    features: "Features",
    noPaidCapabilities: "No paid AI capabilities.",
    capabilityNames: {
      INTERNAL_AI_SEARCH: "Internal AI Job Search",
      EXTERNAL_AI_SEARCH: "External AI Job Search",
    },
    actions: {
      upgradeTo: "Upgrade to {plan}",
      downgradeTo: "Downgrade to {plan}",
      choosePlan: "Choose {plan}",
      paymentSetupComingSoon: "Payment setup coming soon.",
      checkoutHint: "You will confirm before leaving for checkout.",
      downgradeUnavailable: "Downgrades are not available here yet.",
      freePlanNoCheckout: "The free plan does not need checkout.",
    },
    demoCheckout: {
      title: "Checkout",
      demoBadge: "Demo checkout",
      openDemo: "Demo payment — {plan}",
      demoModeNote:
        "Portfolio demo. Switches the plan for demonstration using the safe plan switch — no card is charged and no payment is created.",
      brand: "HR Copilot AI",
      orderSummary: "Order summary",
      selectedPlan: "Selected plan",
      billedMonthly: "Billed monthly",
      subtotal: "Subtotal",
      totalDueToday: "Total due today",
      paymentDetails: "Payment details",
      cardholder: "Cardholder name",
      cardholderPlaceholder: "Alex Morgan",
      cardNumber: "Card number",
      expiry: "Expiry (MM/YY)",
      cvc: "CVC",
      saveCard: "Save card for next time",
      pay: "Pay ${amount}",
      close: "Close checkout",
      demoNote:
        "Demo checkout. Card details are never sent, stored or logged — they stay in this browser and are cleared when the dialog closes.",
      realCheckoutNote:
        "This environment uses the real payment provider. Continue to pay securely on their page.",
      continueToProvider: "Continue to payment provider",
      successTitle: "Payment complete",
      successBody: "{plan} is active. Your plan was refreshed from the server.",
      done: "Done",
      errors: {
        required: "Required.",
        invalidCardNumber: "Enter a card number of 13 to 19 digits.",
        invalidExpiry: "Use MM/YY.",
        invalidCvc: "Enter 3 or 4 digits.",
        formInvalid: "Check the highlighted fields.",
      },
    },
    checkout: {
      confirmTitle: "Start checkout for {plan}?",
      chargedAsKrw: "${usd}/month — charged as ₩{krw} via Toss.",
      confirmDescription:
        "{plan} is {price}. You will go to the payment provider next. Your plan will not change until the backend confirms payment.",
      continue: "Continue to payment",
      errors: {
        invalidTransition: "That plan change is not available yet.",
        unauthenticated: "Sign in again to continue.",
      forbidden: "This account cannot start checkout.",
        routeUnavailable: "Checkout is not available in this environment.",
        conflict: "A checkout is already in progress. Try again in a moment.",
        paymentUnavailable:
          "Payment service is temporarily unavailable. Try again shortly.",
        checkoutUnavailable: "Checkout is unavailable right now. Try again shortly.",
      },
    },
    billing: {
      title: "Billing summary",
      subscriptionStatus: "Subscription status",
      effectiveUntil: "Effective until",
      backendCapabilities: "Backend-provided capabilities",
      unknownStatus: "Status: {status}",
      subscriptionStatuses: {
        PENDING: "Pending",
        ACTIVE: "Active",
        PAST_DUE: "Past due",
        CANCEL_AT_PERIOD_END: "Cancels at period end",
        CANCELLED: "Cancelled",
        EXPIRED: "Expired",
      },
      errors: {
        billingUnavailable:
          "Billing information is temporarily unavailable. Try again shortly.",
        unauthenticated: "Sign in again to view billing.",
        forbidden: "This account cannot view billing.",
      },
    },
    devSwitch: {
      title: "Demo plan switch",
      description:
        "Changes your plan for demonstration only — no payment is taken and no card is charged. The switch asks the backend, then re-reads billing and access before this page changes.",
      portfolioDemo: "Portfolio Demo",
      switchTo: "Switch to {plan}",
      confirmTitle: "Switch to {plan}?",
      confirmDescription:
        "The page will wait for the backend response and then refetch the authoritative billing and capability state.",
      confirm: "Switch plan",
      switching: "Switching plan...",
      planUpdated: "Plan updated from backend state.",
      alreadyOnThisPlan: "Already on this plan.",
      errors: {
        invalidTransition: "That plan switch is not available.",
        unauthenticated: "Sign in again to switch plans.",
        forbidden: "This account cannot switch plans.",
        routeUnavailable: "The demo plan switch is not enabled on this server.",
        conflict: "The plan switch conflicts with current billing state.",
        paymentUnavailable:
          "Payment service is temporarily unavailable. Try again shortly.",
        refreshFailed:
          "The switch finished, but the page could not refresh billing state. Try again.",
        switchUnavailable: "Plan switching is unavailable right now.",
      },
    },
    locked: {
      INTERNAL_AI_SEARCH: {
        title: "Internal AI Job Search",
        description:
          "Ranks jobs published on HR Copilot against your profile and tells you why each one matched. You can apply to them directly here. Normal job search stays available on every plan.",
      },
      EXTERNAL_AI_SEARCH: {
        title: "External AI Job Search",
        description:
          "Searches jobs published outside HR Copilot, saves the ones you want to come back to, and keeps your own record of where you applied. You apply on the employer's own site.",
      },
    },
    cards: {
      FREE: {
        tagline: "Search and apply to jobs published on HR Copilot.",
        features: [
          "Normal job search",
          "Apply to HR Copilot jobs",
          "Saved jobs and application history",
        ],
      },
      PRO: {
        tagline: "Add AI ranking across HR Copilot jobs.",
        features: [
          "Everything in Free",
          "Internal AI Job Search",
          "Match reasons for every job",
        ],
      },
      MAX: {
        tagline: "Add jobs published outside HR Copilot.",
        features: [
          "Everything in Pro",
          "External AI Job Search",
          "Why this match — AI explanations",
          "AI cover letters",
          "AI interview prep",
          "Advanced match breakdown",
          "Saved external jobs",
          "Track where you applied externally",
        ],
      },
    },
  },

  /**
   * Copy shared by every on-demand MAX AI feature.
   *
   * Lives apart from `externalJobs` because cover letter, interview prep and
   * the match breakdown will reuse it verbatim — the frame's wording should
   * not have to be re-agreed per feature, in four languages, each time.
   */
  premiumAi: {
    disclaimer:
      "Written by AI from your profile and this job posting. It explains the match score — it does not change it, and it can be wrong.",
    generating: "Writing your explanation…",
    tryAgain: "Try again",
    unavailable:
      "The explanation could not be written just now. Nothing else on this page is affected.",
    failed: "The explanation could not be loaded.",
    jobGone: "This job is no longer listed, so there is nothing to explain.",
    strengthLabel: "strength",
    gapLabel: "possible gap",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "Could not copy — select the text instead.",
    questionNumber: "Question {number}",
    whyAsked: "Why they may ask",
    howToPrepare: "How to prepare",
  },


  /**
   * The breakdown's own vocabulary.
   *
   * `UNKNOWN` reads "Not enough information" and never anything resembling a
   * verdict: an employer who did not publish a salary has not published a bad
   * one, and this label is the last place that distinction could be lost.
   */
  matchBreakdown: {
    status: {
      STRONG: "Strong",
      PARTIAL: "Partial match",
      GAP: "Gap",
      UNKNOWN: "Not enough information",
    },    dimensions: {
      skills: "Skills",
      seniority: "Seniority",
      workMode: "Work mode",
      employmentType: "Employment type",
      location: "Location",
      salary: "Salary",
      languages: "Languages",
    },

    matched: "Matched",
    missing: "Missing",
  },

};

export default en;
