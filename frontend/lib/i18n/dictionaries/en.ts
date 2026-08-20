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

  nav: {
    sectionWorkspace: "Workspace",
    sectionJobSearch: "Job search",
    dashboard: "Dashboard",
    vacancies: "Vacancies",
    candidates: "Candidates",
    aiSearch: "AI Search",
    compare: "Compare",
    processing: "Processing",
    settings: "Settings",
    findJobs: "Find jobs",
    aiJobMatch: "AI Job Match",
    myApplications: "My applications",
    savedJobs: "Saved jobs",
    myProfile: "My profile",
    openNavigation: "Open navigation",
    closeNavigation: "Close navigation",
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

  auth: {
    signIn: "Sign in",
    signingIn: "Signing in",
    signInSubtitle: "Use your work account to reach your organization’s pipeline.",
    createAccount: "Create your workspace",
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
  },

  register: {
    subtitle: "Sets up your organization and makes you its owner.",
    fullNamePlaceholder: "Jane Doe",
    workEmail: "Work email",
    workEmailPlaceholder: "jane@company.com",
    organizationLabel: "Company or organization",
    organizationPlaceholder: "Northwind Talent",
    slugLabel: "Workspace URL",
    slugPlaceholder: "northwind-talent",
    slugHint: "Lowercase letters, numbers and hyphens. Must be unique.",
    passwordPlaceholder: "At least {min} characters",
    passwordHint: "At least {min} characters.",
    submit: "Create workspace",
    submitting: "Creating workspace",
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
    quickAddCandidate: "Add candidate",
    quickAddCandidateHint: "Create a person, then upload their resume.",
    quickUploadResumes: "Upload resumes",
    quickUploadResumesHint: "Drop PDFs or DOCX and watch them index.",
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
    noCandidates: "No candidates yet",
    noCandidatesHint:
      "Add a candidate and upload their resume to start building your pipeline.",
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
    title: "Candidates",
    description:
      "Everyone in your pipeline, with the state of their documents. Nobody is ranked or filtered by the model.",
    add: "Add candidate",
    addTitle: "Add a candidate",
    addDescription:
      "Create the person first, then upload their resume so it can be indexed.",
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
    added: "Added",
    documents: "Documents",
    documentsUploaded: {
      one: "{count} file uploaded",
      other: "{count} files uploaded",
    } as Plural,
    uploadPrompt:
      "Upload a resume to have it parsed, indexed and checked against this vacancy’s requirements.",
    applications: "Applications",
    applicationsHint:
      "Stage changes are recorded against the person who made them.",
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
    summaryTitle: "AI summary",
    searchingEvidence: "Searching candidate evidence…",
    generatingSummary: "Generating grounded summary…",
  },

  ai: {
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
    nothingToCompare: "Nothing to compare yet",
    nothingToCompareHint:
      "Once a vacancy has candidates with indexed resumes, you can line their requirement evidence up side by side.",
    noneProcessed: "No candidate on this vacancy has finished processing yet.",
    processedRatio:
      "{ready} of {total} candidates on this vacancy have finished processing. The rest appear here once their documents are indexed.",
    selectAtLeast: "Select at least {min} candidates",
    selectAtLeastHint:
      "The comparison lines up requirement evidence from each candidate’s documents.",
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

  settings: {
    title: "Settings",
    description: "Your profile, the organization, and who has access.",
    tabProfile: "Profile",
    tabOrganization: "Organization",
    tabTeam: "Team",
    tabIntegrations: "Integrations",
    tabSecurity: "Security",
    tabLanguage: "Language",
    yourProfile: "Your profile",
    yourProfileHint: "How you appear to the rest of the workspace.",
    fullName: "Full name",
    email: "Email",
    emailLocked: "Changing your sign-in address is not supported by the API yet.",
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
  },

  candidateForm: {
    candidateTitle: "Candidate",
    candidateHint: "Only the name is required — the rest can come from their resume.",
    vacancyTitle: "Vacancy",
    vacancyHint:
      "Attaching a vacancy is what gives the requirement checks something to compare against.",
    applyToVacancy: "Apply to vacancy",
    noVacancy: "No vacancy for now",
    errFullName: "Full name is required.",
    errFullNameShort: "Enter the candidate's full name.",
    errEmail: "Enter a valid email address.",
    errYears: "Enter a number between 0 and 80.",
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
    noCandidates: "No candidates yet",
    noCandidatesHint:
      "Add a candidate and upload their resume — each one is checked against the requirements above.",
    atAGlance: "At a glance",
    lastUpdated: "Last updated",
    readingResumes: "Reading resumes",
    readingResumesHint:
      "Documents attach to a candidate, not to a vacancy. Add the person first, then upload their resume from their page — that is what links the file to these requirements.",
    created: "Created {date}",
    deletedOrWrongLink: "This vacancy may have been deleted, or the link is wrong.",
    candidateRemovedOrWrongLink:
      "This candidate may have been removed, or the link is wrong.",
    newVacancyTitle: "Create vacancy",
    newVacancyHint:
      "Requirements you add here are what every uploaded resume gets checked against.",
    newCandidateHint:
      "Create the person first, then upload their resume on the next screen.",
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

  workspaces: {
    title: "Choose a workspace",
    description:
      "You are signed in once. Each workspace has its own data and its own role.",
    candidate: "Candidate",
    candidateHint: "Your own profile, applications and saved jobs.",
    candidateNotSetUp: "Profile not created yet",
    organizations: "Organizations",
    noOrganizations: "You do not belong to any organization yet.",
    noOrganizationsHint:
      "An organization owner or HR admin can add you to theirs. Until then, the candidate workspace is yours to use.",
    current: "Current",
    open: "Open",
    switching: "Switching workspace…",
    switchFailed: "Could not switch workspace.",
    switchedTo: "Now in {name}",
    membershipRevoked: "Your access to this workspace was removed",
    membershipRevokedHint:
      "Pick another workspace to continue. If this looks wrong, ask an administrator of that organization.",
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
    resumeHint: "PDF or DOCX, up to {size}. Replacing it does not change applications you already sent.",
    noResume: "No resume uploaded yet",
    uploadResume: "Upload resume",
    replaceResume: "Replace resume",
    uploading: "Uploading",
    downloadResume: "Open resume",
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
    save: "Save",
    saved: "Saved",
    unsave: "Remove from saved",
    aboutRole: "About this role",
    noDescription: "This role has no description.",
    requirements: "What they are looking for",
    mustHave: "Must have",
    niceToHave: "Nice to have",
    apply: "Apply",
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
  },

  applications: {
    title: "My applications",
    description: "Every role you applied to, and where each one stands.",
    empty: "No applications yet",
    emptyHint: "Roles you apply to appear here with their current stage.",
    appliedOn: "Applied {date}",
    updatedOn: "Updated {date}",
    submittedResume: "Sent {name}",
    withdraw: "Withdraw",
    withdrawing: "Withdrawing",
    withdrawn: "Application withdrawn",
    withdrawFailed: "Could not withdraw that application.",
    cannotWithdraw: "This application can no longer be withdrawn",
    cannotWithdrawHint:
      "Its stage is final. The hiring team is the only side that can change it now.",
    stageNote:
      "Stages are set by the hiring team. The only change you can make is withdrawing.",
    source: "Source",
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
    title: "AI Job Match",
    description:
      "Find open roles that match your profile and resume, with the evidence behind each match.",
    introTitle: "Which jobs fit me?",
    introHint:
      "Matching compares your own profile and resume against open roles and shows what each requirement is backed by. It takes around twenty seconds.",
    run: "Find my matches",
    refresh: "Refresh matches",
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
    strength: {
      STRONG: "Strong match",
      PARTIAL: "Partial match",
      WEAK: "Weak match",
    },
    coverageNote:
      "Match labels reflect how much of each role's requirements your documents support. They are not a score of you and not an application recommendation.",
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
    notReadyTitle: "Add something to match on",
    notReadyHint:
      "Add skills, experience or a summary to your profile — or upload a resume — so matching has evidence to work with.",
    completeProfile: "Complete profile",
    resumeImproves:
      "A resume improves match quality: requirements are checked against your actual documents.",
    uploadResume: "Upload resume",
    noMatches: "No matching roles right now",
    noMatchesHint:
      "None of the currently open roles matched your profile. New roles are matched as they open — check back later.",
    unavailable: "Matching is temporarily unavailable",
    unavailableHint:
      "The matching service is not reachable right now. Nothing was computed — try again shortly.",
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
};

export default en;
