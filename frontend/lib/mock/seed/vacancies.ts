import type {
  EmploymentType,
  ExperienceLevel,
  JobRequirementDraft,
  VacancyStatus,
} from "@/lib/types";

export interface VacancySeed {
  id: string;
  title: string;
  department: string;
  location: string;
  employmentType: EmploymentType;
  experienceLevel: ExperienceLevel;
  status: VacancyStatus;
  description: string;
  requirements: JobRequirementDraft[];
  preferredSkills: string[];
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export const vacancySeeds: VacancySeed[] = [
  {
    id: "vac-1",
    title: "Senior Backend Engineer",
    department: "Engineering",
    location: "Tashkent, Uzbekistan · Hybrid",
    employmentType: "full_time",
    experienceLevel: "senior",
    status: "open",
    description: [
      "We are building the transaction core of a regional payments platform and are looking for a senior backend engineer to own services end to end.",
      "",
      "You will design and ship NestJS services that handle high-volume event traffic, work closely with the platform team on Kubernetes deployments, and help shape how we model data across PostgreSQL and Redis.",
      "",
      "This role sits inside a product team of six: two backend engineers, two frontend engineers, a designer and a product manager. You will be expected to review designs, write RFCs, and mentor mid-level engineers.",
    ].join("\n"),
    requirements: [
      { label: "NestJS", kind: "must_have", category: "skill", detail: "Production experience building services with NestJS or a comparable Node.js framework." },
      { label: "Kubernetes", kind: "must_have", category: "skill", detail: "Deploying and operating containerized workloads on Kubernetes." },
      { label: "Redis Pub/Sub", kind: "must_have", category: "skill", detail: "Event fan-out or queueing with Redis Pub/Sub or Streams." },
      { label: "PostgreSQL", kind: "must_have", category: "skill", detail: "Schema design, indexing and query tuning on PostgreSQL." },
      { label: "AWS production experience", kind: "must_have", category: "experience", detail: "Running production workloads on AWS." },
      { label: "3+ years backend experience", kind: "must_have", category: "experience", detail: "At least three years in a backend-focused engineering role." },
      { label: "GraphQL", kind: "nice_to_have", category: "skill", detail: "Designing GraphQL schemas for internal or public APIs." },
      { label: "Terraform", kind: "nice_to_have", category: "skill", detail: "Infrastructure as code with Terraform." },
    ],
    preferredSkills: ["TypeScript", "gRPC", "OpenTelemetry", "Kafka", "CI/CD"],
    ownerId: "usr-1",
    createdAt: "2026-07-14T08:30:00.000Z",
    updatedAt: "2026-08-19T15:12:00.000Z",
  },
  {
    id: "vac-2",
    title: "Frontend Engineer, Design Systems",
    department: "Engineering",
    location: "Remote · CET ±3",
    employmentType: "full_time",
    experienceLevel: "mid",
    status: "open",
    description: [
      "Our product surface has grown faster than our component library. We are hiring a frontend engineer to own the design system that four product teams build on.",
      "",
      "You will work in a Next.js App Router codebase, pair with our product designer on component APIs, and be responsible for the accessibility baseline of everything we ship.",
    ].join("\n"),
    requirements: [
      { label: "React", kind: "must_have", category: "skill", detail: "Deep React experience including hooks and composition patterns." },
      { label: "TypeScript", kind: "must_have", category: "skill", detail: "Strictly typed application code." },
      { label: "Next.js App Router", kind: "must_have", category: "skill", detail: "Server and client component boundaries in the App Router." },
      { label: "Design systems", kind: "must_have", category: "experience", detail: "Building or maintaining a shared component library." },
      { label: "Accessibility (WCAG 2.2 AA)", kind: "must_have", category: "skill", detail: "Keyboard navigation, focus management, and screen reader support." },
      { label: "Playwright", kind: "nice_to_have", category: "skill", detail: "End-to-end or component testing with Playwright." },
      { label: "Storybook", kind: "nice_to_have", category: "skill", detail: null },
    ],
    preferredSkills: ["Tailwind CSS", "Figma", "Radix UI", "Visual regression testing"],
    ownerId: "usr-2",
    createdAt: "2026-06-28T11:45:00.000Z",
    updatedAt: "2026-08-18T09:02:00.000Z",
  },
  {
    id: "vac-3",
    title: "Data Engineer",
    department: "Data",
    location: "Tashkent, Uzbekistan · On-site",
    employmentType: "full_time",
    experienceLevel: "mid",
    status: "open",
    description: [
      "You will build the pipelines behind our analytics and reporting products, moving data from operational Postgres into the warehouse and modelling it for the analytics team.",
    ].join("\n"),
    requirements: [
      { label: "Python", kind: "must_have", category: "skill", detail: "Production Python for data pipelines." },
      { label: "Airflow", kind: "must_have", category: "skill", detail: "Authoring and operating scheduled DAGs." },
      { label: "dbt", kind: "must_have", category: "skill", detail: "Warehouse modelling with dbt." },
      { label: "SQL warehouse experience", kind: "must_have", category: "experience", detail: "BigQuery, Snowflake or Redshift in production." },
      { label: "Kafka", kind: "nice_to_have", category: "skill", detail: null },
    ],
    preferredSkills: ["Spark", "Great Expectations", "Looker"],
    ownerId: "usr-3",
    createdAt: "2026-08-04T13:20:00.000Z",
    updatedAt: "2026-08-17T10:41:00.000Z",
  },
  {
    id: "vac-4",
    title: "Product Designer",
    department: "Design",
    location: "Remote · EU",
    employmentType: "contract",
    experienceLevel: "senior",
    status: "on_hold",
    description: [
      "A six-month contract to redesign our onboarding and reporting flows. Paused while the roadmap for Q4 is confirmed.",
    ].join("\n"),
    requirements: [
      { label: "Figma", kind: "must_have", category: "skill", detail: null },
      { label: "B2B SaaS experience", kind: "must_have", category: "experience", detail: "Shipping complex internal tooling or B2B products." },
      { label: "User research", kind: "must_have", category: "skill", detail: "Running and synthesising qualitative research." },
      { label: "Design systems", kind: "nice_to_have", category: "experience", detail: null },
    ],
    preferredSkills: ["Prototyping", "Design tokens", "Accessibility"],
    ownerId: "usr-2",
    createdAt: "2026-05-22T09:15:00.000Z",
    updatedAt: "2026-07-30T16:00:00.000Z",
  },
  {
    id: "vac-5",
    title: "DevOps Engineer",
    department: "Infrastructure",
    location: "Tashkent, Uzbekistan · Hybrid",
    employmentType: "full_time",
    experienceLevel: "senior",
    status: "draft",
    description: [
      "Draft posting. Owns the delivery pipeline and production observability across three clusters.",
    ].join("\n"),
    requirements: [
      { label: "Kubernetes", kind: "must_have", category: "skill", detail: null },
      { label: "Terraform", kind: "must_have", category: "skill", detail: null },
      { label: "CI/CD", kind: "must_have", category: "skill", detail: "GitHub Actions, GitLab CI or comparable." },
      { label: "Observability", kind: "nice_to_have", category: "skill", detail: "Prometheus, Grafana, OpenTelemetry." },
    ],
    preferredSkills: ["ArgoCD", "AWS", "Incident response"],
    ownerId: "usr-1",
    createdAt: "2026-08-12T07:50:00.000Z",
    updatedAt: "2026-08-12T07:50:00.000Z",
  },
  {
    id: "vac-6",
    title: "HR Business Partner",
    department: "People",
    location: "Tashkent, Uzbekistan · On-site",
    employmentType: "full_time",
    experienceLevel: "mid",
    status: "closed",
    description: [
      "Closed in July 2026. Partnered with engineering leadership on headcount planning and performance cycles.",
    ].join("\n"),
    requirements: [
      { label: "HRIS administration", kind: "must_have", category: "skill", detail: null },
      { label: "Employee relations", kind: "must_have", category: "experience", detail: null },
      { label: "Labor law (UZ)", kind: "must_have", category: "certification", detail: null },
    ],
    preferredSkills: ["Compensation benchmarking", "Onboarding design"],
    ownerId: "usr-4",
    createdAt: "2026-02-10T08:00:00.000Z",
    updatedAt: "2026-07-08T12:30:00.000Z",
  },
];
