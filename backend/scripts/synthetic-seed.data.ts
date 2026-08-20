/**
 * Content library for the synthetic development dataset.
 *
 * Everything here is INVENTED: names are assembled from fictional pools,
 * employers and organizations do not exist, and no text is copied from a real
 * person's resume. The library is pure data + deterministic helpers so the
 * seeder itself stays readable.
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32) — same seed, same dataset.
// ---------------------------------------------------------------------------

export const DEFAULT_SEED = 20260820;

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** N distinct items, order deterministic. */
  pickN<T>(items: readonly T[], n: number): T[] {
    const pool = [...items];
    const out: T[] = [];
    while (out.length < n && pool.length > 0) {
      out.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0]!);
    }
    return out;
  }

  weighted<T>(pairs: readonly [T, number][]): T {
    const total = pairs.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.next() * total;
    for (const [value, weight] of pairs) {
      roll -= weight;
      if (roll <= 0) return value;
    }
    return pairs[pairs.length - 1]![0];
  }
}

// ---------------------------------------------------------------------------
// People (fictional)
// ---------------------------------------------------------------------------

export type Region = 'uz' | 'ko' | 'ru' | 'west';
export type ResumeLocale = 'en' | 'uz' | 'ru' | 'ko';

const FIRST_NAMES: Record<Region, string[]> = {
  uz: ['Aziz', 'Bekzod', 'Dilnoza', 'Gulnora', 'Kamola', 'Nodir', 'Otabek',
       'Rustam', 'Sevara', 'Shahzod', 'Zilola', 'Ulugbek', 'Madina', 'Botir',
       'Feruza', 'Sardor', 'Nilufar', 'Javlon', 'Malika', 'Doston'],
  ko: ['Minjun', 'Seoyeon', 'Jihun', 'Haeun', 'Doyun', 'Yuna', 'Siwoo',
       'Chaewon', 'Jiho', 'Sumin', 'Hyunwoo', 'Dain', 'Taeyang', 'Nari'],
  ru: ['Aleksei', 'Ekaterina', 'Dmitri', 'Olga', 'Sergei', 'Anastasia',
       'Nikita', 'Vera', 'Pavel', 'Marina', 'Ivan', 'Larisa', 'Timur', 'Alina'],
  west: ['Ethan', 'Maya', 'Lucas', 'Amelia', 'Noah', 'Sofia', 'Liam', 'Clara',
         'Oscar', 'Freya', 'Adrian', 'Isla', 'Felix', 'Nora'],
};

const LAST_NAMES: Record<Region, string[]> = {
  uz: ['Rakhimov', 'Karimova', 'Tashkentov', 'Yusupova', 'Abdullaev',
       'Nazarova', 'Islomov', 'Saidova', 'Mirzaev', 'Olimova', 'Qodirov',
       'Ergasheva', 'Norboev', 'Akramova'],
  ko: ['Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Yoon', 'Lim', 'Han',
       'Shin', 'Seo', 'Kwon'],
  ru: ['Volkova', 'Petrov', 'Sokolova', 'Ivanov', 'Kuznetsova', 'Smirnov',
       'Popova', 'Vasiliev', 'Morozova', 'Fedorov', 'Orlova', 'Belov'],
  west: ['Hartley', 'Novak', 'Silva', 'Berg', 'Costa', 'Meyer', 'Laurent',
         'Okafor', 'Lindqvist', 'Romano', 'Fischer', 'Dubois'],
};

const CITIES: Record<Region, string[]> = {
  uz: ['Tashkent, UZ', 'Samarkand, UZ', 'Fergana, UZ', 'Bukhara, UZ'],
  ko: ['Seoul, KR', 'Busan, KR', 'Incheon, KR', 'Daejeon, KR'],
  ru: ['Almaty, KZ', 'Tbilisi, GE', 'Yerevan, AM', 'Belgrade, RS'],
  west: ['Berlin, DE', 'Amsterdam, NL', 'Lisbon, PT', 'Warsaw, PL'],
};

export function makePerson(rng: Rng): {
  region: Region;
  fullName: string;
  location: string;
} {
  const region = rng.weighted<Region>([
    ['uz', 0.35], ['ko', 0.2], ['ru', 0.2], ['west', 0.25],
  ]);
  return {
    region,
    fullName: `${rng.pick(FIRST_NAMES[region])} ${rng.pick(LAST_NAMES[region])}`,
    location: rng.pick(CITIES[region]),
  };
}

/** Resume body language, correlated with (but not fixed by) name region. */
export function pickResumeLocale(rng: Rng, region: Region): ResumeLocale {
  const byRegion: Record<Region, [ResumeLocale, number][]> = {
    uz: [['en', 0.5], ['uz', 0.35], ['ru', 0.15]],
    ko: [['en', 0.45], ['ko', 0.55]],
    ru: [['en', 0.5], ['ru', 0.5]],
    west: [['en', 1]],
  };
  return rng.weighted(byRegion[region]);
}

export function spokenLanguages(rng: Rng, region: Region): string[] {
  const base: Record<Region, string[]> = {
    uz: ['Uzbek (native)', 'Russian (B2)', 'English (B1)'],
    ko: ['Korean (native)', 'English (B2)'],
    ru: ['Russian (native)', 'English (B2)'],
    west: ['English (native)'],
  };
  const langs = [...base[region]];
  if (rng.chance(0.2)) langs.push(rng.pick(['German (A2)', 'Korean (A2)', 'Turkish (B1)']));
  return langs;
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

export interface Track {
  key: string;
  label: string;
  titles: string[];
  vacancyTitles: string[];
  core: string[];
  extra: string[];
  rare: string[];
}

export const TRACKS: Track[] = [
  {
    key: 'backend', label: 'Backend',
    titles: ['Backend Engineer', 'Backend Developer', 'Node.js Developer'],
    vacancyTitles: ['Backend Engineer', 'Senior Backend Engineer', 'Backend Engineer (Node.js)'],
    core: ['Node.js', 'NestJS', 'PostgreSQL', 'REST APIs'],
    extra: ['Redis', 'Docker', 'TypeScript', 'GraphQL', 'Kafka', 'RabbitMQ', 'MongoDB', 'gRPC'],
    rare: ['Elixir', 'Rust', 'Event sourcing'],
  },
  {
    key: 'frontend', label: 'Frontend',
    titles: ['Frontend Developer', 'Frontend Engineer', 'UI Engineer'],
    vacancyTitles: ['Frontend Developer', 'Senior Frontend Engineer', 'Frontend Developer (React)'],
    core: ['React', 'TypeScript', 'CSS', 'HTML'],
    extra: ['Next.js', 'Redux', 'Jest', 'Tailwind CSS', 'Vue.js', 'Webpack', 'Accessibility'],
    rare: ['Svelte', 'WebGL', 'Three.js'],
  },
  {
    key: 'fullstack', label: 'Full-stack',
    titles: ['Full-Stack Engineer', 'Full-Stack Developer'],
    vacancyTitles: ['Full-Stack Engineer', 'Full-Stack Developer (Node/React)'],
    core: ['JavaScript', 'React', 'Node.js', 'PostgreSQL'],
    extra: ['TypeScript', 'Express.js', 'Next.js', 'Docker', 'Redis', 'MongoDB'],
    rare: ['Deno', 'HTMX'],
  },
  {
    key: 'devops', label: 'DevOps',
    titles: ['DevOps Engineer', 'Site Reliability Engineer'],
    vacancyTitles: ['DevOps Engineer', 'Site Reliability Engineer', 'DevOps Engineer (Kubernetes)'],
    core: ['Docker', 'Kubernetes', 'CI/CD', 'Linux'],
    extra: ['Terraform', 'GitHub Actions', 'Ansible', 'Prometheus', 'Grafana', 'Nginx', 'AWS'],
    rare: ['Nomad', 'Istio', 'eBPF'],
  },
  {
    key: 'cloud', label: 'Cloud',
    titles: ['Cloud Engineer', 'Cloud Infrastructure Engineer'],
    vacancyTitles: ['Cloud Engineer', 'Cloud Infrastructure Engineer (AWS)'],
    core: ['AWS', 'Terraform', 'Linux', 'Networking'],
    extra: ['Azure', 'GCP', 'CloudFormation', 'Serverless', 'Kubernetes', 'Cost optimization'],
    rare: ['Pulumi', 'OpenStack'],
  },
  {
    key: 'platform', label: 'Platform',
    titles: ['Platform Engineer', 'Infrastructure Engineer'],
    vacancyTitles: ['Platform Engineer', 'Senior Platform Engineer'],
    core: ['Kubernetes', 'Go', 'CI/CD', 'Observability'],
    extra: ['Terraform', 'Helm', 'ArgoCD', 'Prometheus', 'Internal developer platforms'],
    rare: ['Backstage', 'Crossplane'],
  },
  {
    key: 'data', label: 'Data',
    titles: ['Data Engineer', 'Analytics Engineer'],
    vacancyTitles: ['Data Engineer', 'Senior Data Engineer', 'Analytics Engineer'],
    core: ['Python', 'SQL', 'Apache Spark', 'ETL pipelines'],
    extra: ['Airflow', 'dbt', 'BigQuery', 'Snowflake', 'Kafka', 'Data modelling'],
    rare: ['Flink', 'Iceberg'],
  },
  {
    key: 'aiml', label: 'AI/ML',
    titles: ['Machine Learning Engineer', 'AI Engineer'],
    vacancyTitles: ['AI Engineer', 'Machine Learning Engineer', 'ML Platform Engineer'],
    core: ['Python', 'PyTorch', 'Machine learning', 'SQL'],
    extra: ['TensorFlow', 'MLflow', 'Hugging Face Transformers', 'Vector databases', 'LLM fine-tuning'],
    rare: ['JAX', 'Triton'],
  },
  {
    key: 'mobile', label: 'Mobile',
    titles: ['Mobile Engineer', 'React Native Developer', 'Android Developer'],
    vacancyTitles: ['React Native Developer', 'Mobile Engineer (Android)', 'Mobile Engineer'],
    core: ['React Native', 'TypeScript', 'Mobile release management'],
    extra: ['Kotlin', 'Android SDK', 'Swift', 'Firebase', 'GraphQL'],
    rare: ['Flutter', 'Jetpack Compose'],
  },
  {
    key: 'qa', label: 'QA',
    titles: ['QA Engineer', 'QA Automation Engineer', 'Test Engineer'],
    vacancyTitles: ['QA Engineer', 'QA Automation Engineer', 'Senior QA Engineer'],
    core: ['Test planning', 'Selenium', 'API testing'],
    extra: ['Playwright', 'Cypress', 'JMeter', 'Postman', 'CI/CD', 'Python'],
    rare: ['Contract testing', 'Chaos engineering'],
  },
  {
    key: 'security', label: 'Security',
    titles: ['Security Engineer', 'Application Security Engineer'],
    vacancyTitles: ['Security Engineer', 'Application Security Engineer'],
    core: ['Application security', 'OWASP Top 10', 'Penetration testing'],
    extra: ['Burp Suite', 'SIEM', 'Cloud security', 'Threat modelling', 'Python'],
    rare: ['Reverse engineering', 'Cryptography engineering'],
  },
  {
    key: 'product', label: 'Product/UX',
    titles: ['Product Designer', 'UX Researcher', 'Product Manager'],
    vacancyTitles: ['Product Designer', 'UX Researcher', 'Product Manager (Platform)'],
    core: ['Product discovery', 'User research', 'Figma', 'Roadmapping'],
    extra: ['A/B testing', 'SQL', 'Design systems', 'Wireframing', 'Stakeholder management'],
    rare: ['Service design', 'Accessibility audits'],
  },
];

export const TRACK_BY_KEY = new Map(TRACKS.map((t) => [t.key, t]));

// ---------------------------------------------------------------------------
// Organizations (fictional companies)
// ---------------------------------------------------------------------------

export interface OrgSpec {
  name: string;
  slug: string; // always `syn-` prefixed: the reset marker
  focus: string[]; // track keys this company mostly hires for
  city: string;
}

const ORG_DEFS: [string, string[], string][] = [
  ['Chorsu Digital', ['backend', 'devops', 'frontend', 'qa'], 'Tashkent, UZ'],
  ['Hangang Soft', ['backend', 'mobile', 'frontend'], 'Seoul, KR'],
  ['Aurora Data Systems', ['data', 'aiml', 'backend'], 'Berlin, DE'],
  ['Registon Cloudworks', ['cloud', 'devops', 'platform'], 'Samarkand, UZ'],
  ['Baltika Analytics', ['data', 'aiml'], 'Warsaw, PL'],
  ['Namsan Mobility', ['mobile', 'backend', 'qa'], 'Seoul, KR'],
  ['Ipak Yoli Logistics Tech', ['backend', 'fullstack', 'devops'], 'Tashkent, UZ'],
  ['Severny Bridge Software', ['fullstack', 'frontend'], 'Belgrade, RS'],
  ['Quartz Security Lab', ['security', 'devops'], 'Amsterdam, NL'],
  ['Lotus Commerce Cloud', ['fullstack', 'frontend', 'data'], 'Lisbon, PT'],
  ['Tian Shan Robotics', ['aiml', 'platform', 'backend'], 'Almaty, KZ'],
  ['Mirage Fintech', ['backend', 'security', 'qa'], 'Berlin, DE'],
  ['Sirdaryo HealthTech', ['fullstack', 'mobile'], 'Tashkent, UZ'],
  ['Gyeongbok Games', ['backend', 'mobile', 'qa'], 'Busan, KR'],
  ['Nordwind Media Platform', ['frontend', 'product', 'backend'], 'Amsterdam, NL'],
  ['Karakum Energy Digital', ['data', 'cloud'], 'Tashkent, UZ'],
  ['Vega Streaming', ['backend', 'platform', 'frontend'], 'Lisbon, PT'],
  ['Anor EdTech', ['fullstack', 'product', 'qa'], 'Fergana, UZ'],
  ['Han-Gil Bio Informatics', ['data', 'aiml'], 'Daejeon, KR'],
  ['Steppe Ride Hailing', ['backend', 'mobile', 'devops'], 'Almaty, KZ'],
  ['Meridian Travel Systems', ['fullstack', 'frontend'], 'Tbilisi, GE'],
  ['Obsidian DevTools', ['platform', 'backend', 'product'], 'Berlin, DE'],
  ['Sariq Delivery', ['backend', 'mobile', 'qa'], 'Tashkent, UZ'],
  ['Cheonggye AI Studio', ['aiml', 'data', 'product'], 'Seoul, KR'],
  ['Volna Telecom Software', ['backend', 'devops', 'security'], 'Yerevan, AM'],
  ['Islandica Insurance Tech', ['fullstack', 'data', 'qa'], 'Warsaw, PL'],
  ['Bukhara Craft Marketplace', ['frontend', 'fullstack', 'product'], 'Bukhara, UZ'],
  ['Dokdo Maritime Systems', ['backend', 'platform'], 'Busan, KR'],
  ['Pamir Observability', ['platform', 'devops', 'backend'], 'Tashkent, UZ'],
  ['Lumen Retail Robotics', ['aiml', 'mobile'], 'Amsterdam, NL'],
  ['Sogdiana Bank Digital', ['backend', 'security', 'frontend'], 'Samarkand, UZ'],
  ['Taiga Geo Services', ['data', 'cloud', 'backend'], 'Tbilisi, GE'],
  ['Hanok Property Tech', ['fullstack', 'frontend'], 'Seoul, KR'],
  ['Zenith QA Collective', ['qa', 'devops'], 'Belgrade, RS'],
  ['Farabi Legal Tech', ['fullstack', 'product', 'security'], 'Almaty, KZ'],
  ['Cassiopeia Cloud Security', ['security', 'cloud', 'platform'], 'Berlin, DE'],
];

export function orgSpecs(): OrgSpec[] {
  return ORG_DEFS.map(([name, focus, city]) => ({
    name,
    slug: `syn-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    focus,
    city,
  }));
}

// ---------------------------------------------------------------------------
// Fictional employers / universities / certifications for resume bodies
// ---------------------------------------------------------------------------

const EMPLOYERS = [
  'Silk Route Systems', 'Registon Soft', 'Hanbit Digital', 'Severnaya Data',
  'Oqtepa Commerce', 'Mokran Logistics', 'Blue Poplar Media', 'Deltafin Labs',
  'Yulduz Telecom', 'Granite Peak Software', 'Namangan Agrotech',
  'Haneul Mobility', 'Kizilkum Mining Digital', 'Vetra Insurance Systems',
];

const UNIVERSITIES = [
  'Tashkent University of Information Technologies',
  'Inha University in Tashkent',
  'National University of Uzbekistan',
  'Seoul National University', 'Yonsei University', 'Pusan National University',
  'Tbilisi State University', 'University of Warsaw', 'TU Berlin',
  'Al-Farabi Kazakh National University',
];

const CERTS: Record<string, string[]> = {
  devops: ['CKA (Certified Kubernetes Administrator)', 'AWS Certified SysOps Administrator'],
  cloud: ['AWS Certified Solutions Architect - Associate', 'HashiCorp Terraform Associate'],
  platform: ['CKA (Certified Kubernetes Administrator)'],
  backend: ['AWS Certified Developer - Associate'],
  data: ['Google Professional Data Engineer'],
  aiml: ['TensorFlow Developer Certificate'],
  qa: ['ISTQB Certified Tester Foundation Level'],
  security: ['OSCP', 'CompTIA Security+'],
  mobile: ['Google Associate Android Developer'],
  frontend: [],
  fullstack: [],
  product: ['NN/g UX Certification'],
};

// ---------------------------------------------------------------------------
// Resume rendering (en / uz / ru / ko)
// ---------------------------------------------------------------------------

export interface CandidateContent {
  fullName: string;
  headlineTitle: string;
  track: Track;
  skills: string[];
  years: number;
  location: string;
  languages: string[];
  resumeLocale: ResumeLocale;
  email: string;
}

interface ResumeStrings {
  summaryHeader: string;
  skillsHeader: string;
  experienceHeader: string;
  projectsHeader: string;
  educationHeader: string;
  certsHeader: string;
  languagesHeader: string;
  summary: (c: CandidateContent) => string;
  duty: (skill: string, employer: string) => string;
  duty2: (skill: string) => string;
  project: (skill: string) => string;
  degree: (uni: string, year: number) => string;
  present: string;
}

const RESUME_STRINGS: Record<ResumeLocale, ResumeStrings> = {
  en: {
    summaryHeader: 'Summary', skillsHeader: 'Skills', experienceHeader: 'Experience',
    projectsHeader: 'Projects', educationHeader: 'Education',
    certsHeader: 'Certifications', languagesHeader: 'Languages', present: 'present',
    summary: (c) =>
      `${c.track.label} specialist with ${c.years} years of hands-on experience. ` +
      `Focused on ${c.skills.slice(0, 3).join(', ')} and reliable delivery in small product teams.`,
    duty: (skill, employer) =>
      `Designed and maintained production systems built on ${skill} for ${employer}, including code review and on-call support.`,
    duty2: (skill) =>
      `Introduced ${skill} into the team workflow and mentored two junior colleagues in using it well.`,
    project: (skill) =>
      `Side project: an open-source utility built with ${skill}, used by a small community of developers.`,
    degree: (uni, year) => `BSc Computer Science, ${uni} (graduated ${year})`,
  },
  uz: {
    summaryHeader: "Umumiy ma'lumot", skillsHeader: "Ko'nikmalar",
    experienceHeader: 'Ish tajribasi', projectsHeader: 'Loyihalar',
    educationHeader: "Ta'lim", certsHeader: 'Sertifikatlar',
    languagesHeader: 'Tillar', present: 'hozirgacha',
    summary: (c) =>
      `${c.years} yillik amaliy tajribaga ega ${c.track.label} mutaxassisi. ` +
      `Asosiy yo'nalishlar: ${c.skills.slice(0, 3).join(', ')}. Kichik jamoalarda mahsulotni ishonchli yetkazib berishga e'tibor qarataman.`,
    duty: (skill, employer) =>
      `${employer} kompaniyasida ${skill} asosidagi tizimlarni ishlab chiqdim va production muhitida qo'llab-quvvatladim.`,
    duty2: (skill) =>
      `Jamoaga ${skill} texnologiyasini joriy qildim va ikki yosh mutaxassisga ustozlik qildim.`,
    project: (skill) =>
      `Shaxsiy loyiha: ${skill} yordamida yozilgan ochiq kodli vosita, dasturchilar jamoasi foydalanadi.`,
    degree: (uni, year) => `Kompyuter fanlari bakalavri, ${uni} (${year}-yil bitirgan)`,
  },
  ru: {
    summaryHeader: 'О себе', skillsHeader: 'Навыки', experienceHeader: 'Опыт работы',
    projectsHeader: 'Проекты', educationHeader: 'Образование',
    certsHeader: 'Сертификаты', languagesHeader: 'Языки', present: 'настоящее время',
    summary: (c) =>
      `Специалист (${c.track.label}) с ${c.years}-летним практическим опытом. ` +
      `Основные направления: ${c.skills.slice(0, 3).join(', ')}. Ценю надёжную поставку и понятный код.`,
    duty: (skill, employer) =>
      `Разрабатывал и сопровождал production-системы на ${skill} в компании ${employer}, участвовал в код-ревью и дежурствах.`,
    duty2: (skill) =>
      `Внедрил ${skill} в рабочий процесс команды и обучил двух младших специалистов.`,
    project: (skill) =>
      `Личный проект: open-source утилита на ${skill}, которой пользуется небольшое сообщество разработчиков.`,
    degree: (uni, year) => `Бакалавр компьютерных наук, ${uni} (выпуск ${year})`,
  },
  ko: {
    summaryHeader: '자기소개', skillsHeader: '기술', experienceHeader: '경력',
    projectsHeader: '프로젝트', educationHeader: '학력', certsHeader: '자격증',
    languagesHeader: '어학', present: '현재',
    summary: (c) =>
      `${c.years}년의 실무 경험을 가진 ${c.track.label} 엔지니어입니다. ` +
      `${c.skills.slice(0, 3).join(', ')} 중심으로 신뢰할 수 있는 서비스를 만드는 데 집중합니다.`,
    duty: (skill, employer) =>
      `${employer}에서 ${skill} 기반 프로덕션 시스템을 설계하고 운영했으며 코드 리뷰와 장애 대응을 담당했습니다.`,
    duty2: (skill) =>
      `팀에 ${skill}을(를) 도입하고 주니어 개발자 두 명을 멘토링했습니다.`,
    project: (skill) =>
      `사이드 프로젝트: ${skill}(으)로 만든 오픈소스 도구를 개발하여 커뮤니티에서 사용되고 있습니다.`,
    degree: (uni, year) => `${uni} 컴퓨터공학 학사 (${year}년 졸업)`,
  },
};

/** Renders a resume as plain lines (one DOCX paragraph each). */
export function resumeLines(rng: Rng, c: CandidateContent): string[] {
  const s = RESUME_STRINGS[c.resumeLocale];
  const employerA = rng.pick(EMPLOYERS);
  let employerB = rng.pick(EMPLOYERS);
  if (employerB === employerA) employerB = rng.pick(EMPLOYERS);
  const uni = rng.pick(UNIVERSITIES);
  const gradYear = 2026 - c.years - rng.int(0, 3);
  const startA = 2026 - Math.min(c.years, rng.int(1, 4));
  const startB = gradYear + 1;
  const certs = CERTS[c.track.key] ?? [];

  const lines: string[] = [
    c.fullName,
    c.headlineTitle,
    `${c.location} | ${c.email}`,
    '',
    s.summaryHeader,
    s.summary(c),
    '',
    s.skillsHeader,
    c.skills.join(', '),
    '',
    s.experienceHeader,
    `${c.headlineTitle}, ${employerA} (${startA} - ${s.present})`,
    s.duty(c.skills[0] ?? c.track.core[0]!, employerA),
    s.duty2(c.skills[1] ?? c.track.core[1]!),
  ];
  if (c.years >= 3) {
    lines.push(
      '',
      `${c.track.titles[0]}, ${employerB} (${startB} - ${startA})`,
      s.duty(c.skills[2] ?? c.track.core[0]!, employerB),
    );
  }
  lines.push(
    '',
    s.projectsHeader,
    s.project(c.skills[Math.min(3, c.skills.length - 1)] ?? c.track.core[0]!),
    '',
    s.educationHeader,
    s.degree(uni, gradYear),
  );
  if (certs.length > 0 && rng.chance(0.6)) {
    lines.push('', s.certsHeader, rng.pick(certs));
  }
  lines.push('', s.languagesHeader, c.languages.join(', '));
  return lines;
}

// ---------------------------------------------------------------------------
// Vacancy content
// ---------------------------------------------------------------------------

export function vacancyDescription(
  rng: Rng,
  orgName: string,
  title: string,
  skills: string[],
): string {
  const opener = rng.pick([
    `${orgName} is growing its engineering group and is hiring a ${title}.`,
    `We are looking for a ${title} to join ${orgName}.`,
    `${orgName} needs a hands-on ${title} for a small, senior product team.`,
  ]);
  const middle = `Day to day you will work with ${skills.slice(0, 3).join(', ')} and collaborate closely with product and QA.`;
  const closer = rng.pick([
    'We value clear communication, code review culture and sustainable pace.',
    'Hybrid-friendly; the team works in short iterations with real ownership.',
    'You will own features end to end, from design discussion to production.',
  ]);
  return `${opener}\n\n${middle}\n${closer}`;
}

export const EMPLOYMENT_TYPES = ['Full-time', 'Full-time', 'Full-time', 'Contract', 'Part-time'];
export const EXPERIENCE_LEVELS = ['Junior', 'Mid', 'Senior', 'Lead'];
export const DEPARTMENTS: Record<string, string> = {
  backend: 'Engineering', frontend: 'Engineering', fullstack: 'Engineering',
  devops: 'Infrastructure', cloud: 'Infrastructure', platform: 'Infrastructure',
  data: 'Data', aiml: 'Data', mobile: 'Engineering', qa: 'Quality',
  security: 'Security', product: 'Product',
};
