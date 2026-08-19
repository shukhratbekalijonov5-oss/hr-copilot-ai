import type {
  DocumentKind,
  EducationEntry,
  ExperienceEntry,
  ProcessingStatus,
  ReviewState,
} from "@/lib/types";

export interface DocumentSeed {
  id: string;
  fileName: string;
  kind: DocumentKind;
  pageCount: number;
  sizeBytes: number;
  status: ProcessingStatus;
  uploadedAt: string;
}

export interface CandidateSeed {
  id: string;
  fullName: string;
  currentTitle: string;
  email: string;
  phone: string | null;
  location: string;
  yearsOfExperience: number;
  skills: string[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  documents: DocumentSeed[];
  processingStatus: ProcessingStatus;
  reviewState: ReviewState;
  primaryVacancyId: string | null;
  createdAt: string;
  updatedAt: string;
}

const pdf = (
  id: string,
  fileName: string,
  pageCount: number,
  sizeBytes: number,
  status: ProcessingStatus,
  uploadedAt: string,
  kind: DocumentKind = "resume",
): DocumentSeed => ({ id, fileName, kind, pageCount, sizeBytes, status, uploadedAt });

export const candidateSeeds: CandidateSeed[] = [
  {
    id: "cand-1",
    fullName: "Aziz Yusupov",
    currentTitle: "Senior Backend Engineer",
    email: "aziz.yusupov@example.com",
    phone: "+998 90 123 45 67",
    location: "Tashkent, Uzbekistan",
    yearsOfExperience: 7,
    skills: [
      "NestJS", "TypeScript", "Kubernetes", "Redis", "PostgreSQL",
      "AWS", "GraphQL", "Docker", "RabbitMQ", "Terraform",
    ],
    experience: [
      {
        id: "exp-1-1",
        company: "Paynet Digital",
        title: "Senior Backend Engineer",
        location: "Tashkent, Uzbekistan",
        startDate: "2023-03-01",
        endDate: null,
        highlights: [
          "Led the migration of the settlement service from a monolith to six NestJS services deployed on Kubernetes.",
          "Introduced Redis Pub/Sub for cross-service event fan-out, cutting settlement latency from 4s to 380ms.",
          "Owns the PostgreSQL schema for the ledger, including partitioning of a 900M-row transactions table.",
        ],
      },
      {
        id: "exp-1-2",
        company: "Uzum Tech",
        title: "Backend Engineer",
        location: "Tashkent, Uzbekistan",
        startDate: "2020-06-01",
        endDate: "2023-02-28",
        highlights: [
          "Built the order orchestration API in Node.js and TypeScript serving ~1.2k requests per second at peak.",
          "Ran the service on AWS ECS, later moving it to EKS with Terraform-managed infrastructure.",
        ],
      },
      {
        id: "exp-1-3",
        company: "Softline",
        title: "Junior Software Engineer",
        location: "Tashkent, Uzbekistan",
        startDate: "2019-02-01",
        endDate: "2020-05-31",
        highlights: [
          "Maintained internal reporting tools written in Express and PostgreSQL.",
        ],
      },
    ],
    education: [
      {
        id: "edu-1-1",
        institution: "Tashkent University of Information Technologies",
        degree: "BSc",
        field: "Software Engineering",
        startYear: 2015,
        endYear: 2019,
      },
    ],
    documents: [
      pdf("doc-1", "aziz-yusupov-resume.pdf", 3, 412_336, "completed", "2026-08-18T10:04:00.000Z"),
      pdf("doc-1b", "aziz-yusupov-cover-letter.pdf", 1, 88_120, "completed", "2026-08-18T10:04:00.000Z", "cover_letter"),
    ],
    processingStatus: "completed",
    reviewState: "reviewed",
    primaryVacancyId: "vac-1",
    createdAt: "2026-08-18T10:04:00.000Z",
    updatedAt: "2026-08-19T14:22:00.000Z",
  },
  {
    id: "cand-2",
    fullName: "Marina Petrova",
    currentTitle: "Backend Engineer",
    email: "marina.petrova@example.com",
    phone: "+371 2 345 6789",
    location: "Riga, Latvia",
    yearsOfExperience: 5,
    skills: [
      "Node.js", "NestJS", "PostgreSQL", "Redis", "Docker",
      "GraphQL", "TypeScript", "Jest",
    ],
    experience: [
      {
        id: "exp-2-1",
        company: "Printful",
        title: "Backend Engineer",
        location: "Riga, Latvia",
        startDate: "2022-09-01",
        endDate: null,
        highlights: [
          "Owns the fulfilment API built with NestJS and PostgreSQL, serving 40+ internal consumers.",
          "Designed the GraphQL gateway that consolidated four REST services behind one schema.",
          "Uses Redis for caching and rate limiting across the fulfilment estate.",
        ],
      },
      {
        id: "exp-2-2",
        company: "Mintos",
        title: "Software Engineer",
        location: "Riga, Latvia",
        startDate: "2020-01-15",
        endDate: "2022-08-31",
        highlights: [
          "Built loan-servicing background workers in Node.js with BullMQ.",
        ],
      },
    ],
    education: [
      {
        id: "edu-2-1",
        institution: "Riga Technical University",
        degree: "MSc",
        field: "Computer Systems",
        startYear: 2017,
        endYear: 2019,
      },
    ],
    documents: [
      pdf("doc-2", "marina-petrova-cv.pdf", 2, 298_004, "completed", "2026-08-18T10:06:00.000Z"),
    ],
    processingStatus: "completed",
    reviewState: "needs_human_review",
    primaryVacancyId: "vac-1",
    createdAt: "2026-08-18T10:06:00.000Z",
    updatedAt: "2026-08-19T09:15:00.000Z",
  },
  {
    id: "cand-3",
    fullName: "Daniel Osei",
    currentTitle: "Platform Engineer",
    email: "daniel.osei@example.com",
    phone: null,
    location: "Berlin, Germany",
    yearsOfExperience: 8,
    skills: [
      "Kubernetes", "Go", "Terraform", "AWS", "Prometheus",
      "Node.js", "PostgreSQL", "ArgoCD",
    ],
    experience: [
      {
        id: "exp-3-1",
        company: "Zalando",
        title: "Platform Engineer",
        location: "Berlin, Germany",
        startDate: "2021-04-01",
        endDate: null,
        highlights: [
          "Operates 14 Kubernetes clusters on AWS EKS serving 300+ engineering teams.",
          "Wrote the Terraform modules that provision every new service environment.",
          "On-call rotation owner for the ingress and service mesh layer.",
        ],
      },
      {
        id: "exp-3-2",
        company: "SoundCloud",
        title: "Site Reliability Engineer",
        location: "Berlin, Germany",
        startDate: "2018-02-01",
        endDate: "2021-03-31",
        highlights: [
          "Migrated the streaming backend from bare metal onto Kubernetes.",
        ],
      },
    ],
    education: [
      {
        id: "edu-3-1",
        institution: "Kwame Nkrumah University of Science and Technology",
        degree: "BSc",
        field: "Computer Engineering",
        startYear: 2012,
        endYear: 2016,
      },
    ],
    documents: [
      pdf("doc-3", "daniel-osei-resume.pdf", 2, 355_210, "completed", "2026-08-18T10:07:00.000Z"),
    ],
    processingStatus: "completed",
    reviewState: "needs_human_review",
    primaryVacancyId: "vac-1",
    createdAt: "2026-08-18T10:07:00.000Z",
    updatedAt: "2026-08-19T11:30:00.000Z",
  },
  {
    id: "cand-4",
    fullName: "Nilufar Sattorova",
    currentTitle: "Full-stack Engineer",
    email: "nilufar.sattorova@example.com",
    phone: "+998 93 555 12 08",
    location: "Samarkand, Uzbekistan",
    yearsOfExperience: 4,
    skills: [
      "TypeScript", "NestJS", "React", "PostgreSQL", "Docker", "Redis",
    ],
    experience: [
      {
        id: "exp-4-1",
        company: "Ipoteka Bank",
        title: "Full-stack Engineer",
        location: "Samarkand, Uzbekistan",
        startDate: "2022-11-01",
        endDate: null,
        highlights: [
          "Built the internal credit-scoring dashboard end to end: NestJS API, React frontend, PostgreSQL storage.",
          "Added Redis-backed caching that removed 60% of repeat report queries.",
        ],
      },
      {
        id: "exp-4-2",
        company: "Freelance",
        title: "Web Developer",
        location: "Remote",
        startDate: "2021-01-01",
        endDate: "2022-10-31",
        highlights: ["Delivered eight client projects on Node.js and React."],
      },
    ],
    education: [
      {
        id: "edu-4-1",
        institution: "Samarkand State University",
        degree: "BSc",
        field: "Applied Mathematics",
        startYear: 2017,
        endYear: 2021,
      },
    ],
    documents: [
      pdf("doc-4", "nilufar-sattorova-cv.pdf", 2, 241_880, "completed", "2026-08-19T08:12:00.000Z"),
    ],
    processingStatus: "completed",
    reviewState: "not_reviewed",
    primaryVacancyId: "vac-1",
    createdAt: "2026-08-19T08:12:00.000Z",
    updatedAt: "2026-08-19T08:31:00.000Z",
  },
  {
    id: "cand-5",
    fullName: "Ravi Chandran",
    currentTitle: "Staff Software Engineer",
    email: "ravi.chandran@example.com",
    phone: null,
    location: "Bengaluru, India",
    yearsOfExperience: 11,
    skills: [
      "Java", "Kubernetes", "Kafka", "PostgreSQL", "AWS", "gRPC", "Terraform",
    ],
    experience: [
      {
        id: "exp-5-1",
        company: "Razorpay",
        title: "Staff Software Engineer",
        location: "Bengaluru, India",
        startDate: "2020-08-01",
        endDate: null,
        highlights: [
          "Technical owner of the payouts platform running on Kubernetes across three AWS regions.",
          "Introduced Kafka-based event sourcing for reconciliation, replacing nightly batch jobs.",
        ],
      },
      {
        id: "exp-5-2",
        company: "Flipkart",
        title: "Senior Software Engineer",
        location: "Bengaluru, India",
        startDate: "2016-07-01",
        endDate: "2020-07-31",
        highlights: ["Scaled the inventory service to handle Big Billion Days traffic."],
      },
    ],
    education: [
      {
        id: "edu-5-1",
        institution: "NIT Trichy",
        degree: "BTech",
        field: "Computer Science",
        startYear: 2011,
        endYear: 2015,
      },
    ],
    documents: [
      pdf("doc-5", "ravi-chandran-resume.pdf", 3, 401_552, "indexing", "2026-08-20T08:22:00.000Z"),
    ],
    processingStatus: "indexing",
    reviewState: "not_reviewed",
    primaryVacancyId: "vac-1",
    createdAt: "2026-08-20T08:22:00.000Z",
    updatedAt: "2026-08-20T08:47:00.000Z",
  },
  {
    id: "cand-6",
    fullName: "Elena Vasquez",
    currentTitle: "Frontend Engineer",
    email: "elena.vasquez@example.com",
    phone: "+34 611 22 33 44",
    location: "Barcelona, Spain",
    yearsOfExperience: 6,
    skills: [
      "React", "TypeScript", "Next.js", "Tailwind CSS", "Storybook",
      "Playwright", "Accessibility",
    ],
    experience: [
      {
        id: "exp-6-1",
        company: "Typeform",
        title: "Frontend Engineer",
        location: "Barcelona, Spain",
        startDate: "2022-02-01",
        endDate: null,
        highlights: [
          "Maintains the shared component library used by five product teams, documented in Storybook.",
          "Rebuilt the form editor on the Next.js App Router, splitting server and client boundaries.",
          "Drove the WCAG 2.2 AA audit and fixed 40+ keyboard and focus-management defects.",
        ],
      },
      {
        id: "exp-6-2",
        company: "Glovo",
        title: "Frontend Developer",
        location: "Barcelona, Spain",
        startDate: "2019-05-01",
        endDate: "2022-01-31",
        highlights: ["Built the courier-facing web app in React and Redux."],
      },
    ],
    education: [
      {
        id: "edu-6-1",
        institution: "Universitat Politècnica de Catalunya",
        degree: "BSc",
        field: "Informatics Engineering",
        startYear: 2014,
        endYear: 2018,
      },
    ],
    documents: [
      pdf("doc-6", "elena-vasquez-resume.pdf", 2, 320_770, "completed", "2026-08-17T13:44:00.000Z"),
    ],
    processingStatus: "completed",
    reviewState: "reviewed",
    primaryVacancyId: "vac-2",
    createdAt: "2026-08-17T13:44:00.000Z",
    updatedAt: "2026-08-18T16:05:00.000Z",
  },
  {
    id: "cand-7",
    fullName: "Jonas Weber",
    currentTitle: "Senior Frontend Engineer",
    email: "jonas.weber@example.com",
    phone: null,
    location: "Vienna, Austria",
    yearsOfExperience: 9,
    skills: [
      "React", "TypeScript", "Design systems", "Figma", "Vite", "Jest",
    ],
    experience: [
      {
        id: "exp-7-1",
        company: "Dynatrace",
        title: "Senior Frontend Engineer",
        location: "Vienna, Austria",
        startDate: "2021-09-01",
        endDate: null,
        highlights: [
          "Owns the Strato design system: 120 React components consumed by 30 teams.",
          "Defined the component API review process and the token pipeline shared with Figma.",
        ],
      },
      {
        id: "exp-7-2",
        company: "Runtastic",
        title: "Frontend Engineer",
        location: "Linz, Austria",
        startDate: "2016-03-01",
        endDate: "2021-08-31",
        highlights: ["Led the migration from AngularJS to React."],
      },
    ],
    education: [
      {
        id: "edu-7-1",
        institution: "TU Wien",
        degree: "MSc",
        field: "Media Informatics",
        startYear: 2012,
        endYear: 2015,
      },
    ],
    documents: [
      pdf("doc-7", "jonas-weber-cv.pdf", 3, 388_990, "completed", "2026-08-17T13:46:00.000Z"),
    ],
    processingStatus: "completed",
    reviewState: "not_reviewed",
    primaryVacancyId: "vac-2",
    createdAt: "2026-08-17T13:46:00.000Z",
    updatedAt: "2026-08-18T10:20:00.000Z",
  },
  {
    id: "cand-8",
    fullName: "Sofia Almeida",
    currentTitle: "Frontend Developer",
    email: "sofia.almeida@example.com",
    phone: "+351 91 234 5678",
    location: "Lisbon, Portugal",
    yearsOfExperience: 3,
    skills: ["React", "JavaScript", "CSS", "Next.js", "Tailwind CSS"],
    experience: [
      {
        id: "exp-8-1",
        company: "Feedzai",
        title: "Frontend Developer",
        location: "Lisbon, Portugal",
        startDate: "2023-06-01",
        endDate: null,
        highlights: [
          "Builds case-management screens in React and Next.js for fraud analysts.",
        ],
      },
    ],
    education: [
      {
        id: "edu-8-1",
        institution: "Instituto Superior Técnico",
        degree: "BSc",
        field: "Computer Science",
        startYear: 2019,
        endYear: 2022,
      },
    ],
    documents: [
      pdf("doc-8", "sofia-almeida-resume.docx", 1, 145_220, "completed", "2026-08-19T15:03:00.000Z"),
    ],
    processingStatus: "completed",
    reviewState: "not_reviewed",
    primaryVacancyId: "vac-2",
    createdAt: "2026-08-19T15:03:00.000Z",
    updatedAt: "2026-08-19T15:19:00.000Z",
  },
  {
    id: "cand-9",
    fullName: "Bekzod Tursunov",
    currentTitle: "Data Engineer",
    email: "bekzod.tursunov@example.com",
    phone: "+998 97 700 11 22",
    location: "Tashkent, Uzbekistan",
    yearsOfExperience: 5,
    skills: ["Python", "Airflow", "dbt", "BigQuery", "SQL", "Kafka"],
    experience: [
      {
        id: "exp-9-1",
        company: "Click",
        title: "Data Engineer",
        location: "Tashkent, Uzbekistan",
        startDate: "2022-04-01",
        endDate: null,
        highlights: [
          "Runs 140 Airflow DAGs loading operational Postgres data into BigQuery.",
          "Modelled the finance marts in dbt with tested incremental models.",
        ],
      },
    ],
    education: [
      {
        id: "edu-9-1",
        institution: "Westminster International University in Tashkent",
        degree: "BSc",
        field: "Business Information Systems",
        startYear: 2016,
        endYear: 2020,
      },
    ],
    documents: [
      pdf("doc-9", "bekzod-tursunov-cv.pdf", 2, 267_310, "embedding", "2026-08-20T08:30:00.000Z"),
    ],
    processingStatus: "embedding",
    reviewState: "not_reviewed",
    primaryVacancyId: "vac-3",
    createdAt: "2026-08-20T08:30:00.000Z",
    updatedAt: "2026-08-20T08:52:00.000Z",
  },
  {
    id: "cand-10",
    fullName: "Priya Nair",
    currentTitle: "Analytics Engineer",
    email: "priya.nair@example.com",
    phone: null,
    location: "Remote · India",
    yearsOfExperience: 6,
    skills: ["dbt", "SQL", "Snowflake", "Python", "Looker"],
    experience: [
      {
        id: "exp-10-1",
        company: "Freshworks",
        title: "Analytics Engineer",
        location: "Chennai, India",
        startDate: "2021-01-01",
        endDate: null,
        highlights: [
          "Owns the dbt project behind revenue reporting on Snowflake.",
        ],
      },
    ],
    education: [
      {
        id: "edu-10-1",
        institution: "Anna University",
        degree: "BE",
        field: "Information Technology",
        startYear: 2014,
        endYear: 2018,
      },
    ],
    documents: [
      pdf("doc-10", "priya-nair-resume.pdf", 2, 289_440, "chunking", "2026-08-20T08:35:00.000Z"),
    ],
    processingStatus: "chunking",
    reviewState: "not_reviewed",
    primaryVacancyId: "vac-3",
    createdAt: "2026-08-20T08:35:00.000Z",
    updatedAt: "2026-08-20T08:55:00.000Z",
  },
  {
    id: "cand-11",
    fullName: "Timur Ganiev",
    currentTitle: "Backend Developer",
    email: "timur.ganiev@example.com",
    phone: "+998 90 909 09 09",
    location: "Tashkent, Uzbekistan",
    yearsOfExperience: 2,
    skills: ["Node.js", "Express", "MongoDB", "Docker"],
    experience: [
      {
        id: "exp-11-1",
        company: "Delivery Uz",
        title: "Backend Developer",
        location: "Tashkent, Uzbekistan",
        startDate: "2024-05-01",
        endDate: null,
        highlights: [
          "Maintains the courier assignment API written in Express and MongoDB.",
        ],
      },
    ],
    education: [
      {
        id: "edu-11-1",
        institution: "Inha University in Tashkent",
        degree: "BSc",
        field: "Computer Science",
        startYear: 2020,
        endYear: 2024,
      },
    ],
    documents: [
      pdf("doc-11", "timur-ganiev-cv.pdf", 1, 132_770, "parsing", "2026-08-20T08:44:00.000Z"),
    ],
    processingStatus: "parsing",
    reviewState: "not_reviewed",
    primaryVacancyId: "vac-1",
    createdAt: "2026-08-20T08:44:00.000Z",
    updatedAt: "2026-08-20T08:57:00.000Z",
  },
  {
    id: "cand-12",
    fullName: "Anna Kowalski",
    currentTitle: "Product Designer",
    email: "anna.kowalski@example.com",
    phone: null,
    location: "Kraków, Poland",
    yearsOfExperience: 7,
    skills: ["Figma", "Design systems", "User research", "Prototyping"],
    experience: [
      {
        id: "exp-12-1",
        company: "Brainly",
        title: "Product Designer",
        location: "Kraków, Poland",
        startDate: "2021-06-01",
        endDate: null,
        highlights: [
          "Redesigned the tutor onboarding flow after a 12-participant research study.",
        ],
      },
    ],
    education: [
      {
        id: "edu-12-1",
        institution: "Jagiellonian University",
        degree: "MA",
        field: "Cognitive Science",
        startYear: 2013,
        endYear: 2018,
      },
    ],
    documents: [
      pdf("doc-12", "anna-kowalski-portfolio.pdf", 8, 3_412_009, "completed", "2026-07-02T09:10:00.000Z", "portfolio"),
    ],
    processingStatus: "completed",
    reviewState: "reviewed",
    primaryVacancyId: "vac-4",
    createdAt: "2026-07-02T09:10:00.000Z",
    updatedAt: "2026-07-05T12:00:00.000Z",
  },
  {
    id: "cand-13",
    fullName: "Oleg Ivanov",
    currentTitle: "Software Engineer",
    email: "oleg.ivanov@example.com",
    phone: null,
    location: "Almaty, Kazakhstan",
    yearsOfExperience: 4,
    skills: ["Node.js", "TypeScript", "PostgreSQL"],
    experience: [
      {
        id: "exp-13-1",
        company: "Kaspi.kz",
        title: "Software Engineer",
        location: "Almaty, Kazakhstan",
        startDate: "2022-03-01",
        endDate: null,
        highlights: ["Works on the merchant onboarding services."],
      },
    ],
    education: [],
    documents: [
      pdf("doc-13", "oleg-ivanov-resume.pdf", 2, 210_558, "failed", "2026-08-20T08:48:00.000Z"),
    ],
    processingStatus: "failed",
    reviewState: "not_reviewed",
    primaryVacancyId: "vac-1",
    createdAt: "2026-08-20T08:48:00.000Z",
    updatedAt: "2026-08-20T08:51:00.000Z",
  },
  {
    id: "cand-14",
    fullName: "Laura Bianchi",
    currentTitle: "Frontend Engineer",
    email: "laura.bianchi@example.com",
    phone: null,
    location: "Milan, Italy",
    yearsOfExperience: 5,
    skills: ["React", "TypeScript", "Next.js", "Accessibility", "Playwright"],
    experience: [
      {
        id: "exp-14-1",
        company: "Satispay",
        title: "Frontend Engineer",
        location: "Milan, Italy",
        startDate: "2021-10-01",
        endDate: null,
        highlights: [
          "Builds the merchant dashboard in Next.js with an internal component library.",
          "Set up Playwright end-to-end coverage for the checkout flows.",
        ],
      },
    ],
    education: [
      {
        id: "edu-14-1",
        institution: "Politecnico di Milano",
        degree: "MSc",
        field: "Computer Engineering",
        startYear: 2015,
        endYear: 2020,
      },
    ],
    documents: [
      pdf("doc-14", "laura-bianchi-cv.pdf", 2, 277_400, "queued", "2026-08-20T08:56:00.000Z"),
    ],
    processingStatus: "queued",
    reviewState: "not_reviewed",
    primaryVacancyId: "vac-2",
    createdAt: "2026-08-20T08:56:00.000Z",
    updatedAt: "2026-08-20T08:56:00.000Z",
  },
];
