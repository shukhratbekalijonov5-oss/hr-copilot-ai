import type { InterviewQuestionCategory } from "@/lib/types";

export interface SummarySeed {
  headline: string;
  bullets: string[];
  openQuestions: string[];
  generatedAt: string;
}

export interface QuestionSeed {
  category: InterviewQuestionCategory;
  question: string;
  rationale: string;
  /** Requirement label this question probes, matched within the vacancy. */
  requirementLabel: string | null;
}

/**
 * Summaries describe what the documents say. They deliberately avoid ranking,
 * scoring, or recommending an outcome — that is the reviewer's job.
 */
export const summarySeeds: Record<string, SummarySeed> = {
  "cand-1": {
    headline:
      "Seven years of backend work in Uzbek fintech, most recently leading a monolith-to-services migration on NestJS and Kubernetes.",
    bullets: [
      "Current role at Paynet Digital covers service design, deployment and the ledger data model.",
      "Documents describe Redis Pub/Sub used for event fan-out with a stated latency improvement.",
      "AWS experience spans ECS and EKS, with infrastructure managed through Terraform.",
      "Cover letter adds detail on NestJS module structure and testing practice that the resume omits.",
    ],
    openQuestions: [
      "GraphQL appears only in the skills list — no described project confirms it.",
      "The resume does not state team size or how much of the migration they personally designed.",
    ],
    generatedAt: "2026-08-18T10:31:00.000Z",
  },
  "cand-2": {
    headline:
      "Five years of Node.js backend work in Latvian fintech and e-commerce, centred on NestJS APIs and a GraphQL gateway.",
    bullets: [
      "Owns a NestJS fulfilment API described as serving 40+ internal consumers.",
      "Designed a GraphQL gateway consolidating four REST services.",
      "Redis is used for caching and rate limiting; no messaging pattern is described.",
      "No Kubernetes, AWS or Terraform experience appears anywhere in the document.",
    ],
    openQuestions: [
      "Container orchestration experience is not evidenced — worth asking directly.",
      "Deployment environment for the fulfilment API is never named.",
    ],
    generatedAt: "2026-08-18T10:33:00.000Z",
  },
  "cand-3": {
    headline:
      "Eight years in platform and reliability engineering in Berlin, operating Kubernetes at large scale on AWS.",
    bullets: [
      "Runs 14 EKS clusters serving 300+ teams, with Terraform-managed environments.",
      "Owns the observability stack and the alert routing policy.",
      "Application-framework experience is in Go tooling; NestJS is not mentioned.",
      "PostgreSQL experience is platform-side — failover, pooling — rather than schema design.",
    ],
    openQuestions: [
      "Requirement asks for product backend experience; this history is platform/SRE. Human judgement needed.",
      "No evidence about Node.js or TypeScript service development.",
    ],
    generatedAt: "2026-08-18T10:35:00.000Z",
  },
  "cand-4": {
    headline:
      "Four years of full-stack work, currently building internal banking tools with NestJS, React and PostgreSQL.",
    bullets: [
      "Delivered a credit-scoring dashboard end to end, including API and data model.",
      "Redis is described as a cache layer, not as a messaging system.",
      "No cloud provider, container orchestration or IaC experience appears in the document.",
    ],
    openQuestions: [
      "Deployment and operations exposure is unclear from the resume.",
      "Team context for the dashboard project is not described.",
    ],
    generatedAt: "2026-08-19T08:29:00.000Z",
  },
  "cand-6": {
    headline:
      "Six years of frontend work in Barcelona, currently maintaining a component library used by five product teams.",
    bullets: [
      "Design system ownership includes component API design, releases and a deprecation policy.",
      "Rebuilt a form editor on the Next.js App Router with explicit server/client boundaries.",
      "Led a WCAG 2.2 AA audit and the remediation that followed.",
      "Storybook and Chromatic are described as part of the component release flow.",
    ],
    openQuestions: [
      "Playwright appears in a tooling list only; depth is unconfirmed.",
      "The document does not say how the library is versioned or consumed across repositories.",
    ],
    generatedAt: "2026-08-17T14:02:00.000Z",
  },
  "cand-7": {
    headline:
      "Nine years of frontend engineering in Austria, currently owning a 120-component design system at Dynatrace.",
    bullets: [
      "Defined the component API review process and a design-token pipeline shared with Figma.",
      "Led an AngularJS to React migration in a previous role.",
      "Accessibility is named as a checklist item; no audit or conformance level is stated.",
      "Next.js is not mentioned anywhere in the document.",
    ],
    openQuestions: [
      "No evidence of App Router or server-component work.",
      "Unclear how much of the design system they authored versus inherited.",
    ],
    generatedAt: "2026-08-17T14:05:00.000Z",
  },
  "cand-8": {
    headline:
      "Three years of frontend development at Feedzai, building analyst-facing screens in React and Next.js.",
    bullets: [
      "Current work is case-management UI for fraud analysts.",
      "Stack list names Next.js and Tailwind CSS but not the router model used.",
      "TypeScript, design-system ownership and accessibility work are not evidenced.",
    ],
    openQuestions: [
      "Router model (App vs Pages) is not stated.",
      "The vacancy asks for strictly typed application code; the document lists JavaScript only.",
    ],
    generatedAt: "2026-08-19T15:16:00.000Z",
  },
  "cand-12": {
    headline:
      "Seven years of product design, mostly in consumer education, with recent internal tooling work.",
    bullets: [
      "Portfolio documents a moderated 12-participant study feeding an onboarding redesign.",
      "All work is prototyped in Figma against a shared token and component library.",
      "B2B SaaS exposure is limited to internal admin tools.",
    ],
    openQuestions: [
      "Whether internal tooling satisfies the B2B SaaS requirement is a human call.",
      "No design-system ownership is described, only consumption.",
    ],
    generatedAt: "2026-07-02T09:41:00.000Z",
  },
};

/**
 * Interview questions are drafted from what the documents do and do not say.
 * Each one carries the reason it was generated so a recruiter can drop it.
 */
export const questionSeeds: Record<string, QuestionSeed[]> = {
  "cand-1": [
    {
      category: "system_design",
      question:
        "Walk me through the settlement migration: what were the six service boundaries, and what forced you to draw them where you did?",
      rationale:
        "The resume states the migration but not the decomposition reasoning.",
      requirementLabel: "NestJS",
    },
    {
      category: "technical",
      question:
        "You used Redis Pub/Sub for event fan-out. How did you handle a subscriber being down when an event was published?",
      rationale:
        "Pub/Sub has no delivery guarantee; the resume cites a latency win but not durability handling.",
      requirementLabel: "Redis Pub/Sub",
    },
    {
      category: "technical",
      question:
        "How did you partition the 900M-row transactions table, and what did you have to change in the query layer afterwards?",
      rationale: "Named as an ownership area on page 1 of the resume.",
      requirementLabel: "PostgreSQL",
    },
    {
      category: "experience",
      question:
        "GraphQL is in your skills list. Where have you used it, and what did you build with it?",
      rationale:
        "Evidence review flagged GraphQL as skills-list-only with no supporting project.",
      requirementLabel: "GraphQL",
    },
  ],
  "cand-2": [
    {
      category: "technical",
      question:
        "How is the fulfilment API deployed and operated today, and how involved are you in that?",
      rationale:
        "No deployment environment or orchestration platform appears in the document.",
      requirementLabel: "Kubernetes",
    },
    {
      category: "system_design",
      question:
        "What drove the decision to put a GraphQL gateway in front of four REST services rather than consolidating them?",
      rationale: "The gateway is described as a deliverable, not as a decision.",
      requirementLabel: "GraphQL",
    },
    {
      category: "technical",
      question:
        "You use Redis for caching and rate limiting. Have you used it for messaging between services, and if so how?",
      rationale:
        "The Redis Pub/Sub requirement was flagged for review — described usage is caching.",
      requirementLabel: "Redis Pub/Sub",
    },
    {
      category: "collaboration",
      question:
        "With 40+ internal consumers of your API, how do you manage breaking changes?",
      rationale: "Consumer count is stated; change management is not.",
      requirementLabel: null,
    },
  ],
  "cand-3": [
    {
      category: "system_design",
      question:
        "How is the multi-cluster EKS topology laid out, and what made you choose that over fewer, larger clusters?",
      rationale: "14 clusters is stated as a fact without the reasoning.",
      requirementLabel: "Kubernetes",
    },
    {
      category: "experience",
      question:
        "This role is product backend rather than platform. What application services have you written and owned end to end?",
      rationale:
        "The backend-experience requirement was flagged: the history is platform/SRE.",
      requirementLabel: "3+ years backend experience",
    },
    {
      category: "technical",
      question:
        "Describe the Terraform module layout for a new service environment. How do teams consume it?",
      rationale: "Terraform modules are cited as their work on page 1.",
      requirementLabel: "Terraform",
    },
    {
      category: "collaboration",
      question:
        "You own alert routing for 300+ services. How do you keep on-call load reasonable for the teams you serve?",
      rationale: "Observability ownership is evidenced on page 2.",
      requirementLabel: null,
    },
  ],
  "cand-4": [
    {
      category: "technical",
      question:
        "Take me through the credit-scoring data model. What did you have to change once real report queries arrived?",
      rationale: "Schema and indexing work is cited on page 1.",
      requirementLabel: "PostgreSQL",
    },
    {
      category: "experience",
      question:
        "How does your work reach production today — who deploys it, and on what?",
      rationale:
        "No cloud, container or CI/CD evidence appears anywhere in the document.",
      requirementLabel: "AWS production experience",
    },
    {
      category: "technical",
      question:
        "The caching layer removed 60% of repeat queries. How did you decide what to cache and how to invalidate it?",
      rationale: "The result is quantified; the method is not described.",
      requirementLabel: "Redis Pub/Sub",
    },
  ],
  "cand-6": [
    {
      category: "system_design",
      question:
        "How do you decide a component belongs in the shared library rather than in a product team's codebase?",
      rationale: "Library ownership across five teams is evidenced on page 1.",
      requirementLabel: "Design systems",
    },
    {
      category: "technical",
      question:
        "In the form editor rebuild, where did you draw the server/client boundary and what forced those choices?",
      rationale: "App Router work is described but not the boundary reasoning.",
      requirementLabel: "Next.js App Router",
    },
    {
      category: "technical",
      question:
        "Of the 40+ accessibility defects you fixed, which was the hardest to solve structurally rather than patch?",
      rationale: "WCAG 2.2 AA audit work is evidenced on page 2.",
      requirementLabel: "Accessibility (WCAG 2.2 AA)",
    },
    {
      category: "experience",
      question:
        "Playwright appears in your tooling list. What have you tested with it, and at what level?",
      rationale: "Flagged during evidence review as list-only.",
      requirementLabel: "Playwright",
    },
  ],
  "cand-7": [
    {
      category: "system_design",
      question:
        "Describe the token pipeline between Figma and code. What breaks in it today?",
      rationale: "The pipeline is cited as their design on page 1.",
      requirementLabel: "Design systems",
    },
    {
      category: "technical",
      question:
        "Have you worked with React Server Components or the Next.js App Router? If not, what is the closest thing you have shipped?",
      rationale:
        "The App Router requirement has no supporting evidence in the document.",
      requirementLabel: "Next.js App Router",
    },
    {
      category: "technical",
      question:
        "What does 'accessibility' mean concretely in your component acceptance checklist?",
      rationale:
        "Accessibility was flagged for review — mentioned as process, not as outcome.",
      requirementLabel: "Accessibility (WCAG 2.2 AA)",
    },
  ],
  "cand-8": [
    {
      category: "technical",
      question:
        "Which Next.js routing model does the case-management app use, and have you worked in the other one?",
      rationale: "The document names Next.js without specifying the router.",
      requirementLabel: "Next.js App Router",
    },
    {
      category: "technical",
      question:
        "Is the analyst UI written in TypeScript? If so, how strictly is it configured?",
      rationale:
        "The vacancy requires strict TypeScript; the document lists JavaScript.",
      requirementLabel: "TypeScript",
    },
    {
      category: "collaboration",
      question:
        "How do you and the designers agree on a component's API before you build it?",
      rationale:
        "Design-system experience is a requirement with no evidence in the document.",
      requirementLabel: "Design systems",
    },
  ],
  "cand-12": [
    {
      category: "experience",
      question:
        "Tell me about the two internal admin tools. Who were the users and how were success criteria set?",
      rationale:
        "B2B SaaS experience was flagged for review — internal tooling is the closest evidence.",
      requirementLabel: "B2B SaaS experience",
    },
    {
      category: "technical",
      question:
        "How did the 12-participant study change the onboarding design from what you first proposed?",
      rationale: "The study is evidenced on page 4 of the portfolio.",
      requirementLabel: "User research",
    },
    {
      category: "collaboration",
      question:
        "You consume a shared component library. What would you change about how it is governed?",
      rationale:
        "Design-systems experience is a nice-to-have with no ownership evidence.",
      requirementLabel: "Design systems",
    },
  ],
};
