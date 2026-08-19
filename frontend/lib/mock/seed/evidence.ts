import type { EvidenceStatus } from "@/lib/types";

export interface CitationSeed {
  documentId: string;
  page: number;
  snippet: string;
}

export interface EvidenceSeed {
  status: EvidenceStatus;
  citations: CitationSeed[];
  note?: string;
}

/**
 * candidateId -> requirement label -> extracted evidence.
 *
 * Requirements absent from a candidate's map resolve to `not_found`, which is
 * how the backend is expected to behave: absence of evidence is reported, not
 * inferred as a negative judgement about the person.
 */
export const evidenceSeeds: Record<string, Record<string, EvidenceSeed>> = {
  "cand-1": {
    NestJS: {
      status: "found",
      citations: [
        {
          documentId: "doc-1",
          page: 1,
          snippet:
            "Led the migration of the settlement service from a monolith to six NestJS services deployed on Kubernetes.",
        },
        {
          documentId: "doc-1b",
          page: 1,
          snippet:
            "Most of my last four years has been NestJS: module boundaries, custom decorators, and testing with the Nest testing module.",
        },
      ],
    },
    Kubernetes: {
      status: "found",
      citations: [
        {
          documentId: "doc-1",
          page: 2,
          snippet:
            "Deployed containerized backend services using Kubernetes (EKS), including HPA tuning and rolling releases across three environments.",
        },
      ],
    },
    "Redis Pub/Sub": {
      status: "found",
      citations: [
        {
          documentId: "doc-1",
          page: 1,
          snippet:
            "Introduced Redis Pub/Sub for cross-service event fan-out, cutting settlement latency from 4s to 380ms.",
        },
      ],
    },
    PostgreSQL: {
      status: "found",
      citations: [
        {
          documentId: "doc-1",
          page: 1,
          snippet:
            "Owns the PostgreSQL schema for the ledger, including partitioning of a 900M-row transactions table.",
        },
      ],
    },
    "AWS production experience": {
      status: "found",
      citations: [
        {
          documentId: "doc-1",
          page: 2,
          snippet:
            "Ran the service on AWS ECS, later moving it to EKS with Terraform-managed infrastructure.",
        },
      ],
    },
    "3+ years backend experience": {
      status: "found",
      citations: [
        {
          documentId: "doc-1",
          page: 1,
          snippet:
            "Backend engineering roles since February 2019 — Softline, Uzum Tech, and Paynet Digital.",
        },
      ],
    },
    GraphQL: {
      status: "needs_human_review",
      citations: [
        {
          documentId: "doc-1",
          page: 3,
          snippet: "Skills: TypeScript, NestJS, GraphQL, gRPC, Docker, Terraform.",
        },
      ],
      note: "Listed under skills only. No project or role describes GraphQL work — worth asking about in a screen.",
    },
    Terraform: {
      status: "found",
      citations: [
        {
          documentId: "doc-1",
          page: 2,
          snippet:
            "Managed EKS clusters, VPC networking and RDS instances as Terraform modules reviewed through pull requests.",
        },
      ],
    },
  },

  "cand-2": {
    NestJS: {
      status: "found",
      citations: [
        {
          documentId: "doc-2",
          page: 1,
          snippet:
            "Owns the fulfilment API built with NestJS and PostgreSQL, serving 40+ internal consumers.",
        },
      ],
    },
    PostgreSQL: {
      status: "found",
      citations: [
        {
          documentId: "doc-2",
          page: 1,
          snippet:
            "Designed the fulfilment schema on PostgreSQL 15 and tuned the queries behind the warehouse picking view.",
        },
      ],
    },
    "Redis Pub/Sub": {
      status: "needs_human_review",
      citations: [
        {
          documentId: "doc-2",
          page: 2,
          snippet:
            "Uses Redis for caching and rate limiting across the fulfilment estate.",
        },
      ],
      note: "Redis is present, but the described use is caching and rate limiting rather than Pub/Sub messaging.",
    },
    "3+ years backend experience": {
      status: "found",
      citations: [
        {
          documentId: "doc-2",
          page: 1,
          snippet:
            "Software engineering roles since January 2020 — Mintos, then Printful.",
        },
      ],
    },
    GraphQL: {
      status: "found",
      citations: [
        {
          documentId: "doc-2",
          page: 1,
          snippet:
            "Designed the GraphQL gateway that consolidated four REST services behind one schema.",
        },
      ],
    },
  },

  "cand-3": {
    Kubernetes: {
      status: "found",
      citations: [
        {
          documentId: "doc-3",
          page: 1,
          snippet:
            "Operates 14 Kubernetes clusters on AWS EKS serving 300+ engineering teams.",
        },
        {
          documentId: "doc-3",
          page: 2,
          snippet:
            "Migrated the streaming backend from bare metal onto Kubernetes over an 18-month programme.",
        },
      ],
    },
    "AWS production experience": {
      status: "found",
      citations: [
        {
          documentId: "doc-3",
          page: 1,
          snippet:
            "Production AWS across EKS, RDS, S3 and Route53, with cost ownership for the platform account.",
        },
      ],
    },
    Terraform: {
      status: "found",
      citations: [
        {
          documentId: "doc-3",
          page: 1,
          snippet:
            "Wrote the Terraform modules that provision every new service environment.",
        },
      ],
    },
    PostgreSQL: {
      status: "found",
      citations: [
        {
          documentId: "doc-3",
          page: 2,
          snippet:
            "Ran the shared PostgreSQL platform, including failover drills and connection pooling with PgBouncer.",
        },
      ],
    },
    "3+ years backend experience": {
      status: "needs_human_review",
      citations: [
        {
          documentId: "doc-3",
          page: 1,
          snippet:
            "Eight years across site reliability and platform engineering roles, writing Go tooling and internal services.",
        },
      ],
      note: "Long engineering history, but the roles are platform/SRE rather than product backend. A human should decide whether this meets the requirement.",
    },
    Observability: {
      status: "found",
      citations: [
        {
          documentId: "doc-3",
          page: 2,
          snippet:
            "Owns the Prometheus and Grafana stack, and the alert routing policy for 300+ services.",
        },
      ],
    },
    "CI/CD": {
      status: "found",
      citations: [
        {
          documentId: "doc-3",
          page: 2,
          snippet:
            "Replaced Jenkins with GitHub Actions and ArgoCD for progressive delivery.",
        },
      ],
    },
  },

  "cand-4": {
    NestJS: {
      status: "found",
      citations: [
        {
          documentId: "doc-4",
          page: 1,
          snippet:
            "Built the internal credit-scoring dashboard end to end: NestJS API, React frontend, PostgreSQL storage.",
        },
      ],
    },
    PostgreSQL: {
      status: "found",
      citations: [
        {
          documentId: "doc-4",
          page: 1,
          snippet:
            "Normalised the scoring schema in PostgreSQL and added covering indexes for the analyst report queries.",
        },
      ],
    },
    "Redis Pub/Sub": {
      status: "needs_human_review",
      citations: [
        {
          documentId: "doc-4",
          page: 1,
          snippet:
            "Added Redis-backed caching that removed 60% of repeat report queries.",
        },
      ],
      note: "Redis usage is cache-only in the document. No messaging or Pub/Sub pattern described.",
    },
    "3+ years backend experience": {
      status: "found",
      citations: [
        {
          documentId: "doc-4",
          page: 1,
          snippet:
            "Freelance web development from January 2021, then full-stack engineering at Ipoteka Bank from November 2022.",
        },
      ],
    },
  },

  "cand-6": {
    React: {
      status: "found",
      citations: [
        {
          documentId: "doc-6",
          page: 1,
          snippet:
            "Maintains the shared component library used by five product teams, documented in Storybook.",
        },
      ],
    },
    TypeScript: {
      status: "found",
      citations: [
        {
          documentId: "doc-6",
          page: 1,
          snippet:
            "The component library is strict-mode TypeScript with generated prop-type documentation.",
        },
      ],
    },
    "Next.js App Router": {
      status: "found",
      citations: [
        {
          documentId: "doc-6",
          page: 1,
          snippet:
            "Rebuilt the form editor on the Next.js App Router, splitting server and client component boundaries.",
        },
      ],
    },
    "Design systems": {
      status: "found",
      citations: [
        {
          documentId: "doc-6",
          page: 1,
          snippet:
            "Owns component API design and the release process for the shared library, including a deprecation policy.",
        },
      ],
    },
    "Accessibility (WCAG 2.2 AA)": {
      status: "found",
      citations: [
        {
          documentId: "doc-6",
          page: 2,
          snippet:
            "Drove the WCAG 2.2 AA audit and fixed 40+ keyboard and focus-management defects.",
        },
      ],
    },
    Playwright: {
      status: "needs_human_review",
      citations: [
        {
          documentId: "doc-6",
          page: 2,
          snippet: "Tooling: Storybook, Playwright, Vitest, Chromatic.",
        },
      ],
      note: "Appears in a tooling list only. No described work confirms depth.",
    },
    Storybook: {
      status: "found",
      citations: [
        {
          documentId: "doc-6",
          page: 1,
          snippet:
            "Every component ships with Storybook stories and a Chromatic visual regression baseline.",
        },
      ],
    },
  },

  "cand-7": {
    React: {
      status: "found",
      citations: [
        {
          documentId: "doc-7",
          page: 1,
          snippet:
            "Owns the Strato design system: 120 React components consumed by 30 teams.",
        },
      ],
    },
    TypeScript: {
      status: "found",
      citations: [
        {
          documentId: "doc-7",
          page: 1,
          snippet:
            "Migrated the design system to TypeScript and published typed entry points per component.",
        },
      ],
    },
    "Design systems": {
      status: "found",
      citations: [
        {
          documentId: "doc-7",
          page: 1,
          snippet:
            "Defined the component API review process and the token pipeline shared with Figma.",
        },
      ],
    },
    "Accessibility (WCAG 2.2 AA)": {
      status: "needs_human_review",
      citations: [
        {
          documentId: "doc-7",
          page: 2,
          snippet:
            "Accessibility is part of the component acceptance checklist for the design system.",
        },
      ],
      note: "Accessibility is mentioned as a process step. No conformance level or audit work is stated.",
    },
    Storybook: {
      status: "found",
      citations: [
        {
          documentId: "doc-7",
          page: 2,
          snippet:
            "Documentation site generated from Storybook, with usage guidelines per component.",
        },
      ],
    },
  },

  "cand-8": {
    React: {
      status: "found",
      citations: [
        {
          documentId: "doc-8",
          page: 1,
          snippet:
            "Builds case-management screens in React and Next.js for fraud analysts.",
        },
      ],
    },
    "Next.js App Router": {
      status: "needs_human_review",
      citations: [
        {
          documentId: "doc-8",
          page: 1,
          snippet: "Stack: React, Next.js, Tailwind CSS, REST APIs.",
        },
      ],
      note: "Next.js is named, but the document does not say whether the work used the App Router or the Pages Router.",
    },
  },

  "cand-12": {
    Figma: {
      status: "found",
      citations: [
        {
          documentId: "doc-12",
          page: 2,
          snippet:
            "All case studies were designed and prototyped in Figma, with a shared library of tokens and components.",
        },
      ],
    },
    "User research": {
      status: "found",
      citations: [
        {
          documentId: "doc-12",
          page: 4,
          snippet:
            "Redesigned the tutor onboarding flow after a 12-participant moderated research study.",
        },
      ],
    },
    "B2B SaaS experience": {
      status: "needs_human_review",
      citations: [
        {
          documentId: "doc-12",
          page: 1,
          snippet:
            "Seven years designing consumer education products, with two internal admin tools in the last year.",
        },
      ],
      note: "Internal tooling is described, but not a B2B SaaS product sold to other businesses.",
    },
  },
};
