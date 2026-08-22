/**
 * Deterministic CONTENT for the final-test applicant dataset.
 *
 * Pure functions only — no database, no filesystem, no clock, no unseeded
 * randomness. The same seed always produces the same 97 people, which is what
 * makes the seeder safe to re-run (see finaltest-seed.ts).
 *
 * Everything here is FICTIONAL. Employers, universities, products and people
 * are invented for this dataset; the email domain is `example.test` (an
 * RFC 6761 reserved TLD that can never resolve). Nothing points at a real
 * person, a real company, or a real URL.
 *
 * The point of this module is VARIETY. A hundred resumes that differ only by
 * name would exercise the parser and nothing else: ranking, Compare, JD
 * evidence and Ask all need candidates who genuinely differ in seniority,
 * stack, domain and how their CV is written. So each person draws from a
 * different archetype, gets a different section layout, a different number of
 * roles, and prose assembled from per-tier phrasing pools.
 */
import { Rng } from './synthetic-seed.data';

/** Fixed seed. Bump only when the dataset is deliberately meant to change. */
export const FINALTEST_SEED = 20260822;

/** The dev password every synthetic account shares (development only). */
export const FINALTEST_PASSWORD = 'DevPassword123!';

/**
 * THE batch marker, and the only safe basis for cleanup.
 *
 * `finaltest.<track>.<NNN>@example.test`. Deliberately does NOT match the
 * ~200-user dataset's own marker (`^(candidate|owner|recruiter)\d{3}@…`), so
 * `npm run seed:synthetic:reset` cannot touch this batch and this batch's
 * cleanup cannot touch that one. Hand-made dev accounts match neither.
 */
export const FINALTEST_EMAIL_PATTERN =
  /^finaltest\.(frontend|backend)\.\d{3}@example\.test$/;

export const isFinalTestEmail = (email: string): boolean =>
  FINALTEST_EMAIL_PATTERN.test(email);

export type TrackKey = 'frontend' | 'backend';
export type Tier = 'strong' | 'medium' | 'weak';

export interface PlannedFinalTestCandidate {
  /** `finaltest.frontend.001@example.test` — unique, deterministic. */
  email: string;
  fullName: string;
  track: TrackKey;
  tier: Tier;
  headline: string;
  location: string;
  phone: string;
  summary: string;
  skills: string[];
  languages: string[];
  years: number;
  experience: {
    title: string;
    company: string;
    startDate: string;
    endDate: string;
    description: string;
  }[];
  education: {
    institution: string;
    degree: string;
    field: string;
    startYear: string;
    endYear: string;
  }[];
  resumeFileName: string;
  resumeLines: string[];
}

// ---------------------------------------------------------------------------
// Fictional people
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  'Amara',
  'Nikhil',
  'Sofia',
  'Tomas',
  'Yuki',
  'Elena',
  'Marcus',
  'Priya',
  'Hana',
  'Diego',
  'Anja',
  'Rustam',
  'Chloe',
  'Ibrahim',
  'Lena',
  'Kwame',
  'Mira',
  'Oskar',
  'Farida',
  'Jonas',
  'Aiko',
  'Bilal',
  'Clara',
  'Dmitri',
  'Esther',
  'Felipe',
  'Greta',
  'Hassan',
  'Iris',
  'Jamal',
  'Karin',
  'Luca',
  'Maya',
  'Nadia',
  'Omar',
  'Petra',
  'Quentin',
  'Rosa',
  'Samir',
  'Tara',
  'Ulrich',
  'Vera',
  'Wei',
  'Xenia',
  'Yusuf',
  'Zara',
  'Anton',
  'Beatriz',
  'Caleb',
  'Dilnoza',
  'Emil',
  'Fatima',
  'Gustav',
  'Helena',
  'Idris',
  'Jasmin',
  'Kiran',
  'Laila',
  'Mateo',
  'Noor',
  'Otto',
  'Paulina',
  'Rafael',
  'Sana',
];

const LAST_NAMES = [
  'Okonkwo',
  'Sharma',
  'Moreau',
  'Novak',
  'Tanaka',
  'Petrova',
  'Lindqvist',
  'Raman',
  'Kim',
  'Alvarez',
  'Bergstrom',
  'Karimov',
  'Dubois',
  'Haddad',
  'Vogel',
  'Mensah',
  'Solberg',
  'Kovac',
  'Nasser',
  'Ericsson',
  'Watanabe',
  'Rahman',
  'Ferreira',
  'Volkov',
  'Adeyemi',
  'Santos',
  'Brandt',
  'Aziz',
  'Lehtinen',
  'Diallo',
  'Weiss',
  'Ricci',
  'Sandoval',
  'Yilmaz',
  'Blomqvist',
  'Nakamura',
  'Toshmatov',
  'Marchetti',
  'Osei',
  'Halvorsen',
  'Baranov',
  'Cardoso',
  'Ekstrom',
  'Farooq',
  'Grimaldi',
  'Hoffmann',
  'Iversen',
  'Jansen',
  'Kaur',
  'Lindberg',
  'Mwangi',
  'Nurmi',
  'Oyelaran',
  'Pahlavi',
  'Quinones',
  'Rasmussen',
  'Silva',
  'Turchin',
  'Ustinov',
  'Varga',
  'Wallenberg',
  'Zubair',
];

const CITIES = [
  'Tashkent, UZ',
  'Seoul, KR',
  'Berlin, DE',
  'Lisbon, PT',
  'Toronto, CA',
  'Warsaw, PL',
  'Amsterdam, NL',
  'Nairobi, KE',
  'Bengaluru, IN',
  'Osaka, JP',
  'Prague, CZ',
  'Stockholm, SE',
  'Valencia, ES',
  'Tallinn, EE',
  'Almaty, KZ',
  'Manchester, UK',
  'Porto, PT',
  'Helsinki, FI',
  'Dublin, IE',
  'Vilnius, LT',
];

/** Invented employers — no real company names. */
const EMPLOYERS = [
  'Aurora Freight Systems',
  'Bluepeak Analytics',
  'Cindermill Software',
  'Driftwood Health',
  'Ember & Co Retail',
  'Fernhollow Logistics',
  'Glasswing Media',
  'Harborline Banking',
  'Ironvale Robotics',
  'Juniper Grid Energy',
  'Kestrel Learning',
  'Lanternhouse Travel',
  'Meridian Foodworks',
  'Northbank Insurance',
  'Orchid Point Telecom',
  'Pinewharf Studios',
  'Quarrystone Mining',
  'Redcliff Mobility',
  'Saltmarsh Payments',
  'Thistlebank Legal',
  'Umbrella Fields Agritech',
  'Verdant Loop Recycling',
  'Windrow Marketplace',
  'Yellowgate Ticketing',
  'Zephyr Clinic Systems',
  'Copperline Property',
  'Deepfield Research',
  'Everstone Hospitality',
  'Foxglove Fintech',
  'Greyharbor Shipping',
];

/** Invented institutions. */
const UNIVERSITIES = [
  'Westmarch Institute of Technology',
  'Riverbend State University',
  'Northgate Polytechnic',
  'Silvermont University',
  'Eastvale Technical College',
  'Highfield University of Applied Sciences',
  'Cloverdale Institute',
  'Brackenridge University',
  'Summerhill College of Engineering',
  'Lakemoor Technical University',
  'Ashford Grove University',
  'Thorncastle Institute of Computing',
];

const DEGREES = [
  ['BSc', 'Computer Science'],
  ['BSc', 'Software Engineering'],
  ['BEng', 'Information Systems'],
  ['MSc', 'Computer Science'],
  ['BSc', 'Applied Mathematics'],
  ['BA', 'Digital Media'],
  ['BSc', 'Information Technology'],
  ['MSc', 'Distributed Systems'],
];

const LANGUAGE_SETS = [
  ['English (fluent)'],
  ['English (fluent)', 'Russian (native)'],
  ['English (professional)', 'Uzbek (native)'],
  ['English (fluent)', 'Korean (native)'],
  ['English (fluent)', 'German (conversational)'],
  ['English (professional)', 'Spanish (native)'],
  ['English (fluent)', 'Russian (fluent)', 'Uzbek (native)'],
  ['English (native)'],
  ['English (fluent)', 'Japanese (business)'],
  ['English (professional)', 'Portuguese (native)'],
];

/** Product domains, so two candidates with the same stack still read apart. */
const DOMAINS = [
  'a freight tracking platform',
  'a telehealth booking product',
  'an online grocery marketplace',
  'a school administration suite',
  'an insurance claims portal',
  'a energy-usage dashboard',
  'a ticketing and events platform',
  'a payments reconciliation tool',
  'a fleet-maintenance system',
  'a recruitment CRM',
  'a property-listings portal',
  'a subscription billing service',
  'a warehouse inventory system',
  'a customer-support console',
  'a legal document workflow',
  'a hotel booking engine',
];

// ---------------------------------------------------------------------------
// Archetypes — what makes strong/medium/weak genuinely different evidence
// ---------------------------------------------------------------------------

interface Archetype {
  tier: Tier;
  /** Job title shown as the headline. */
  titles: string[];
  /** Always present — the skills that define this archetype. */
  core: string[];
  /** Drawn from at random, so two people of one archetype still differ. */
  optional: string[];
  /** Plausible experience range in years. */
  yearsRange: [number, number];
}

/**
 * FRONTEND pool. The vacancy requires TypeScript and React (CSS preferred),
 * so "strong" carries both plus the modern surround, "medium" carries part of
 * it, and "weak" is a real developer whose evidence sits elsewhere.
 */
const FRONTEND_ARCHETYPES: Archetype[] = [
  {
    tier: 'strong',
    titles: [
      'Senior Frontend Engineer',
      'Frontend Engineer',
      'Frontend Developer',
    ],
    core: ['React', 'TypeScript', 'Next.js', 'JavaScript', 'HTML', 'CSS'],
    optional: [
      'Tailwind CSS',
      'React Query',
      'Redux',
      'Zustand',
      'Playwright',
      'Cypress',
      'Storybook',
      'Jest',
      'React Testing Library',
      'GraphQL',
      'REST APIs',
      'Web accessibility (WCAG)',
      'Performance optimisation',
      'Responsive design',
      'Vite',
      'Webpack',
      'Git',
    ],
    yearsRange: [4, 8],
  },
  {
    tier: 'strong',
    titles: ['UI Engineer', 'Frontend Engineer', 'Product Engineer (Frontend)'],
    core: ['React', 'TypeScript', 'CSS', 'HTML', 'Responsive design'],
    optional: [
      'Next.js',
      'Design systems',
      'Storybook',
      'Figma handoff',
      'Web accessibility (WCAG)',
      'Tailwind CSS',
      'SCSS',
      'Jest',
      'React Testing Library',
      'REST APIs',
      'Git',
      'CSS Grid',
      'Framer Motion',
    ],
    yearsRange: [3, 6],
  },
  {
    tier: 'medium',
    titles: ['Frontend Developer', 'Web Developer'],
    core: ['React', 'JavaScript', 'CSS', 'HTML'],
    optional: [
      'TypeScript (basic)',
      'Bootstrap',
      'jQuery',
      'REST APIs',
      'Redux',
      'Git',
      'Responsive design',
      'SASS',
    ],
    yearsRange: [2, 4],
  },
  {
    tier: 'medium',
    titles: [
      'Frontend Engineer (Vue)',
      'Vue.js Developer',
      'Angular Developer',
    ],
    core: ['Vue.js', 'JavaScript', 'TypeScript', 'CSS', 'HTML'],
    optional: [
      'Nuxt.js',
      'Angular',
      'RxJS',
      'Vuex',
      'Pinia',
      'React (exposure)',
      'REST APIs',
      'Git',
      'Jest',
      'Responsive design',
    ],
    yearsRange: [3, 6],
  },
  {
    tier: 'medium',
    titles: ['Full Stack Developer', 'Full Stack Engineer'],
    core: ['React', 'Node.js', 'JavaScript', 'PostgreSQL'],
    optional: [
      'TypeScript',
      'Express',
      'REST APIs',
      'CSS',
      'Docker',
      'MongoDB',
      'Git',
      'HTML',
      'Next.js (some)',
    ],
    yearsRange: [2, 5],
  },
  {
    tier: 'medium',
    titles: ['Junior Frontend Developer', 'Frontend Developer'],
    core: ['React', 'JavaScript', 'HTML', 'CSS'],
    optional: [
      'TypeScript (learning)',
      'Git',
      'REST APIs',
      'Responsive design',
      'Bootstrap',
      'Figma',
    ],
    yearsRange: [1, 2],
  },
  {
    tier: 'weak',
    titles: ['Backend Engineer', 'Backend Developer'],
    core: ['Java', 'Spring Boot', 'PostgreSQL', 'REST APIs'],
    optional: [
      'Docker',
      'Kafka',
      'JUnit',
      'Maven',
      'Git',
      'Microservices',
      'HTML (basic)',
      'JavaScript (basic)',
    ],
    yearsRange: [3, 7],
  },
  {
    tier: 'weak',
    titles: ['Mobile Developer', 'iOS Engineer', 'Android Engineer'],
    core: ['Swift', 'Kotlin', 'Mobile UI'],
    optional: [
      'React Native (some)',
      'REST APIs',
      'Firebase',
      'Git',
      'JavaScript (basic)',
      'XCTest',
      'Jetpack Compose',
    ],
    yearsRange: [2, 6],
  },
  {
    tier: 'weak',
    titles: ['QA Automation Engineer', 'Test Automation Engineer'],
    core: ['Selenium', 'Test automation', 'JavaScript'],
    optional: [
      'Cypress',
      'Playwright',
      'Jest',
      'CI/CD',
      'Git',
      'Postman',
      'TypeScript (basic)',
      'Manual testing',
    ],
    yearsRange: [2, 5],
  },
  {
    tier: 'weak',
    titles: ['Junior Developer', 'Graduate Software Engineer'],
    core: ['Python', 'JavaScript', 'Git'],
    optional: [
      'HTML',
      'CSS',
      'Django',
      'SQL',
      'React (coursework)',
      'Data structures',
    ],
    yearsRange: [0, 1],
  },
];

/**
 * BACKEND pool. The vacancy requires Docker and NestJS/Next.js experience, so
 * "strong" is the Node/Nest/Docker stack, "medium" is a backend engineer on a
 * different runtime, and "weak" is a real developer from an adjacent discipline.
 */
const BACKEND_ARCHETYPES: Archetype[] = [
  {
    tier: 'strong',
    titles: ['Backend Engineer', 'Senior Backend Engineer', 'Node.js Engineer'],
    core: [
      'Node.js',
      'TypeScript',
      'NestJS',
      'PostgreSQL',
      'Docker',
      'REST APIs',
    ],
    optional: [
      'Redis',
      'BullMQ',
      'GraphQL',
      'MongoDB',
      'Prisma',
      'TypeORM',
      'Jest',
      'Microservices',
      'CI/CD',
      'AWS',
      'Kubernetes',
      'JWT authentication',
      'API design',
      'Background jobs',
      'Message queues',
      'Performance tuning',
      'Git',
    ],
    yearsRange: [4, 8],
  },
  {
    tier: 'strong',
    titles: ['Backend Engineer', 'Platform Engineer', 'API Engineer'],
    core: ['Node.js', 'TypeScript', 'Express', 'Docker', 'PostgreSQL'],
    optional: [
      'NestJS',
      'Redis',
      'REST APIs',
      'GraphQL',
      'Queues',
      'Jest',
      'OAuth2',
      'Swagger/OpenAPI',
      'MongoDB',
      'CI/CD',
      'Git',
      'Nginx',
      'Database indexing',
      'Integration testing',
    ],
    yearsRange: [3, 6],
  },
  {
    tier: 'medium',
    titles: ['Backend Engineer (Java)', 'Java Developer', 'Software Engineer'],
    core: ['Java', 'Spring Boot', 'PostgreSQL', 'REST APIs'],
    optional: [
      'Docker',
      'Kafka',
      'Hibernate',
      'JUnit',
      'Maven',
      'Microservices',
      'Redis',
      'CI/CD',
      'Git',
      'MySQL',
    ],
    yearsRange: [3, 7],
  },
  {
    tier: 'medium',
    titles: ['Python Developer', 'Backend Engineer (Python)'],
    core: ['Python', 'FastAPI', 'PostgreSQL', 'REST APIs'],
    optional: [
      'Docker',
      'Django',
      'Celery',
      'Redis',
      'pytest',
      'SQLAlchemy',
      'Pandas',
      'Git',
      'CI/CD',
      'MongoDB',
    ],
    yearsRange: [2, 6],
  },
  {
    tier: 'medium',
    titles: ['Full Stack Engineer', 'Full Stack Developer'],
    core: ['Node.js', 'React', 'JavaScript', 'MongoDB'],
    optional: [
      'TypeScript',
      'Express',
      'REST APIs',
      'Docker (basic)',
      'PostgreSQL',
      'Next.js',
      'Git',
      'Jest',
    ],
    yearsRange: [2, 5],
  },
  {
    tier: 'medium',
    titles: ['Junior Backend Developer', 'Backend Developer'],
    core: ['Node.js', 'JavaScript', 'Express', 'MySQL'],
    optional: [
      'REST APIs',
      'Git',
      'MongoDB',
      'TypeScript (learning)',
      'Docker (learning)',
      'Postman',
    ],
    yearsRange: [1, 2],
  },
  {
    tier: 'weak',
    titles: ['Frontend Engineer', 'Frontend Developer'],
    core: ['React', 'TypeScript', 'CSS', 'HTML'],
    optional: [
      'Next.js',
      'Tailwind CSS',
      'Redux',
      'REST APIs',
      'Git',
      'Node.js (basic)',
      'Jest',
      'Responsive design',
    ],
    yearsRange: [3, 6],
  },
  {
    tier: 'weak',
    titles: ['QA Automation Engineer', 'SDET'],
    core: ['Test automation', 'Selenium', 'Python'],
    optional: [
      'Playwright',
      'CI/CD',
      'Postman',
      'SQL',
      'Git',
      'JMeter',
      'API testing',
      'Manual testing',
    ],
    yearsRange: [2, 5],
  },
  {
    tier: 'weak',
    titles: ['Mobile Developer', 'Flutter Developer'],
    core: ['Flutter', 'Dart', 'Mobile UI'],
    optional: [
      'Firebase',
      'REST APIs',
      'Kotlin',
      'Swift',
      'Git',
      'SQLite',
      'State management',
    ],
    yearsRange: [2, 5],
  },
  {
    tier: 'weak',
    titles: ['Junior Developer', 'Graduate Engineer'],
    core: ['Python', 'SQL', 'Git'],
    optional: [
      'Flask',
      'JavaScript',
      'Linux',
      'Data structures',
      'Node.js (coursework)',
      'HTML',
    ],
    yearsRange: [0, 1],
  },
];

const ARCHETYPES: Record<TrackKey, Archetype[]> = {
  frontend: FRONTEND_ARCHETYPES,
  backend: BACKEND_ARCHETYPES,
};

// ---------------------------------------------------------------------------
// Prose pools — phrasing varies so resumes do not read as one template
// ---------------------------------------------------------------------------

const SUMMARY_TEMPLATES = [
  (t: string, y: number, s: string, d: string) =>
    `${t} with ${y} years building ${d}. Day-to-day work centres on ${s}, with a habit of shipping small and measuring what changed.`,
  (t: string, y: number, s: string, d: string) =>
    `${t}, ${y} years' experience. Most recently on ${d}, working mainly with ${s}. Comfortable owning a feature from first ticket to production.`,
  (t: string, y: number, s: string, d: string) =>
    `${y} years as a ${t.toLowerCase()}. Strongest with ${s}; most of that experience came from ${d} and the support load that follows a launch.`,
  (t: string, y: number, s: string, d: string) =>
    `${t} focused on ${s}. Spent the last stretch on ${d}, where the interesting problems were reliability and keeping the codebase readable as the team grew.`,
  (t: string, y: number, s: string, d: string) =>
    `${t} with ${y} years of commercial experience across ${s}, most recently on ${d}. Prefer teams that review each other's work and write things down.`,
];

const DUTY_TEMPLATES = [
  (s: string, d: string) => `Built and maintained ${d} using ${s}.`,
  (s: string, d: string) =>
    `Owned several modules of ${d}; ${s} was the core of the stack.`,
  (s: string, d: string) =>
    `Worked primarily in ${s} on ${d}, covering feature work, code review and on-call fixes.`,
  (s: string, d: string) =>
    `Delivered incremental releases of ${d}, with ${s} across the parts I owned.`,
  (s: string, d: string) =>
    `Responsible for ${s} on ${d}, within a team of six engineers and one designer.`,
];

const ACHIEVEMENT_TEMPLATES = [
  (n: number) =>
    `Cut page load time by roughly ${n}% by trimming bundle size and deferring non-critical work.`,
  (n: number) =>
    `Reduced the flaky-test rate from ${n}% to under 2%, which made the pipeline trustworthy again.`,
  (n: number) =>
    `Brought p95 response time down by about ${n}% after adding the missing indexes and caching the hot reads.`,
  (n: number) =>
    `Migrated ${n} legacy endpoints to the new service without a customer-visible outage.`,
  (n: number) =>
    `Raised automated test coverage on the critical path from ${n}% to just over 80%.`,
  (n: number) =>
    `Handled a ${n}x traffic increase during a seasonal peak with no additional infrastructure.`,
];

const PROJECT_TEMPLATES = [
  (s: string, d: string) =>
    `Internal tool for ${d} — ${s}. Used daily by the operations team.`,
  (s: string, d: string) =>
    `Side project: a small ${d.replace(/^an? /, '')} built with ${s} to try the stack properly.`,
  (s: string, d: string) =>
    `Rebuilt the reporting section of ${d} using ${s}, replacing a spreadsheet export.`,
  (s: string, d: string) =>
    `Open-source-style practice repo exploring ${s}, modelled on ${d}; documented the trade-offs in the README.`,
];

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const pad = (n: number): string => String(n).padStart(3, '0');

/** Distinct skill list: core plus a tier-appropriate number of optionals. */
function buildSkills(rng: Rng, archetype: Archetype): string[] {
  const extras =
    archetype.tier === 'strong'
      ? rng.int(5, 8)
      : archetype.tier === 'medium'
        ? rng.int(3, 5)
        : rng.int(2, 4);
  const pool = [...archetype.optional];
  const chosen: string[] = [];
  for (let i = 0; i < extras && pool.length > 0; i += 1) {
    chosen.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]);
  }
  return [...archetype.core, ...chosen];
}

/**
 * One person, fully realised.
 *
 * `index` is the position within the track, so the email is stable across
 * runs: person 7 of the frontend track is always finaltest.frontend.007.
 */
export function makeFinalTestCandidate(
  track: TrackKey,
  index: number,
  archetype: Archetype,
  rng: Rng,
): PlannedFinalTestCandidate {
  const first = rng.pick(FIRST_NAMES);
  const last = rng.pick(LAST_NAMES);
  const fullName = `${first} ${last}`;
  const email = `finaltest.${track}.${pad(index)}@example.test`;
  const title = rng.pick(archetype.titles);
  const years = rng.int(archetype.yearsRange[0], archetype.yearsRange[1]);
  const skills = buildSkills(rng, archetype);
  const location = rng.pick(CITIES);
  const domain = rng.pick(DOMAINS);
  const topSkills = skills.slice(0, 3).join(', ');

  const summary = rng.pick(SUMMARY_TEMPLATES)(title, years, topSkills, domain);

  // Employment history: more roles for more experience, always distinct.
  const roleCount = years >= 6 ? 3 : years >= 3 ? 2 : 1;
  const employers: string[] = [];
  while (employers.length < roleCount) {
    const candidate = rng.pick(EMPLOYERS);
    if (!employers.includes(candidate)) employers.push(candidate);
  }
  const thisYear = 2026;
  let cursor = thisYear;
  const experience = employers.map((company, i) => {
    const span =
      i === 0 ? Math.max(1, Math.min(years, rng.int(1, 4))) : rng.int(1, 3);
    const endYear = cursor;
    const startYear = Math.max(thisYear - years, cursor - span);
    cursor = startYear;
    const roleTitle = i === 0 ? title : rng.pick(archetype.titles);
    return {
      title: roleTitle,
      company,
      startDate: `${startYear}-0${rng.int(1, 9)}`,
      endDate: i === 0 ? '' : `${endYear}-0${rng.int(1, 9)}`,
      description: rng.pick(DUTY_TEMPLATES)(
        skills.slice(i, i + 2).join(' and ') || skills[0],
        domain,
      ),
    };
  });

  const [level, field] = rng.pick(DEGREES);
  const gradYear = thisYear - years - rng.int(0, 2);
  const university = rng.pick(UNIVERSITIES);
  const education = [
    {
      institution: university,
      degree: level,
      field: field,
      startYear: String(gradYear - 4),
      endYear: String(gradYear),
    },
  ];

  const languages = rng.pick(LANGUAGE_SETS);
  const phone = `+998 ${rng.int(90, 99)} ${rng.int(100, 999)} ${rng.int(10, 99)} ${rng.int(10, 99)}`;

  const resumeLines = buildResumeLines(rng, {
    fullName,
    title,
    location,
    email,
    phone,
    summary,
    skills,
    experience,
    education,
    languages,
    years,
    domain,
    tier: archetype.tier,
  });

  return {
    email,
    fullName,
    track,
    tier: archetype.tier,
    headline: title,
    location,
    phone,
    summary,
    skills,
    languages,
    years,
    experience,
    education,
    resumeFileName: `${first}-${last}-CV.docx`.toLowerCase(),
    resumeLines,
  };
}

/**
 * The resume body, as paragraph lines for buildDocx().
 *
 * Section ORDER and PRESENCE vary per person (some lead with skills, some with
 * experience; projects and certifications appear only sometimes), so the
 * section detector and chunker see genuinely different documents rather than
 * one layout a hundred times.
 */
function buildResumeLines(
  rng: Rng,
  c: {
    fullName: string;
    title: string;
    location: string;
    email: string;
    phone: string;
    summary: string;
    skills: string[];
    experience: PlannedFinalTestCandidate['experience'];
    education: PlannedFinalTestCandidate['education'];
    languages: string[];
    years: number;
    domain: string;
    tier: Tier;
  },
): string[] {
  const lines: string[] = [
    c.fullName,
    c.title,
    `${c.location} | ${c.email} | ${c.phone}`,
    '',
    'Summary',
    c.summary,
    '',
  ];

  const skillsBlock = (): string[] => ['Skills', c.skills.join(', '), ''];

  const experienceBlock = (): string[] => {
    const out: string[] = ['Experience'];
    for (const role of c.experience) {
      const period = role.endDate
        ? `${role.startDate} - ${role.endDate}`
        : `${role.startDate} - Present`;
      out.push(`${role.title}, ${role.company} (${period})`);
      out.push(role.description);
      // Achievement bullets: seniors get more, juniors sometimes none.
      const bullets = c.tier === 'strong' ? rng.int(1, 2) : rng.int(0, 1);
      for (let i = 0; i < bullets; i += 1) {
        out.push(`- ${rng.pick(ACHIEVEMENT_TEMPLATES)(rng.int(15, 60))}`);
      }
      out.push('');
    }
    return out;
  };

  // Experienced people lead with experience; newer people lead with skills.
  if (c.years >= 3) {
    lines.push(...experienceBlock(), ...skillsBlock());
  } else {
    lines.push(...skillsBlock(), ...experienceBlock());
  }

  if (rng.chance(0.65)) {
    lines.push(
      'Projects',
      rng.pick(PROJECT_TEMPLATES)(c.skills.slice(0, 2).join(' and '), c.domain),
      '',
    );
  }

  lines.push('Education');
  for (const entry of c.education) {
    lines.push(
      `${entry.degree} ${entry.field}, ${entry.institution} (${entry.startYear} - ${entry.endYear})`,
    );
  }
  lines.push('', 'Languages', c.languages.join(', '));
  return lines;
}

/**
 * The tier mix for one track, as a flat list.
 *
 * Ordered strong → medium → weak but ASSIGNED to indexes after shuffling, so
 * the visible applicant list is not sorted by quality — a recruiter opening
 * the vacancy sees a realistically jumbled pool.
 */
export function planTrack(
  track: TrackKey,
  counts: { strong: number; medium: number; weak: number },
  startIndex: number,
  seed: number,
): PlannedFinalTestCandidate[] {
  // Per-track offset: without it both tracks draw the same names in the same
  // order, and finaltest.frontend.001 would be the same person as
  // finaltest.backend.001.
  const rng = new Rng(seed + TRACK_SEED_OFFSET[track]);
  const pool = ARCHETYPES[track];
  const tiers: Tier[] = [
    ...Array<Tier>(counts.strong).fill('strong'),
    ...Array<Tier>(counts.medium).fill('medium'),
    ...Array<Tier>(counts.weak).fill('weak'),
  ];

  // Deterministic Fisher-Yates so quality is spread through the list.
  for (let i = tiers.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.next() * (i + 1));
    [tiers[i], tiers[j]] = [tiers[j], tiers[i]];
  }

  // Display names are kept distinct within a track: two "Maya Diallo" rows in
  // one applicant list read as a duplicate even though the accounts differ.
  const usedNames = new Set<string>();
  return tiers.map((tier, offset) => {
    const options = pool.filter((archetype) => archetype.tier === tier);
    const archetype = options[Math.floor(rng.next() * options.length)];
    let person = makeFinalTestCandidate(
      track,
      startIndex + offset,
      archetype,
      rng,
    );
    for (
      let attempt = 0;
      usedNames.has(person.fullName) && attempt < 20;
      attempt += 1
    ) {
      person = makeFinalTestCandidate(
        track,
        startIndex + offset,
        archetype,
        rng,
      );
    }
    usedNames.add(person.fullName);
    return person;
  });
}

/** Keeps the two tracks' people genuinely different. */
const TRACK_SEED_OFFSET: Record<TrackKey, number> = {
  frontend: 0,
  backend: 7919,
};
