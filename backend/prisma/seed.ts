/**
 * Development seed data.
 *
 * Everything below is invented for local development. No real candidate,
 * employee or applicant data may ever be placed in this file — it is committed
 * to the repository and shared with every contributor.
 *
 * The cast deliberately exercises every identity shape the product supports:
 *   - owner / recruiter / interviewer memberships
 *   - one user with memberships in TWO organizations under different roles
 *   - one user who is a job seeker only (CandidateAccount, no memberships)
 *   - one user who is BOTH a job seeker and a recruiter
 *   - a rival organization so tenant isolation stays testable by hand
 *
 * Run with: yarn db:seed
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  ApplicationSource,
  ApplicationStatus,
  Locale,
  RequirementType,
  Role,
  VacancyStatus,
} from '../src/generated/prisma/enums';
import { buildPublicSlug } from '../src/vacancies/vacancy-slug.util';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed the database');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Local-only development password. Never used outside seeding. */
const DEV_PASSWORD = 'DevPassword123!';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database');
  }

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  const upsertUser = (
    email: string,
    fullName: string,
    preferredLocale: Locale = Locale.en,
  ) =>
    prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, passwordHash, fullName, preferredLocale },
    });

  const upsertMembership = (userId: string, organizationId: string, role: Role) =>
    prisma.organizationMember.upsert({
      where: { userId_organizationId: { userId, organizationId } },
      update: { role },
      create: { userId, organizationId, role },
    });

  // --- Organizations --------------------------------------------------------

  const northwind = await prisma.organization.upsert({
    where: { slug: 'northwind-labs' },
    update: {},
    create: { name: 'Northwind Labs (Demo)', slug: 'northwind-labs' },
  });

  // Exists purely so tenant-isolation can be exercised by hand in development
  // — its data must never be visible to the first organization.
  const rival = await prisma.organization.upsert({
    where: { slug: 'acme-rival' },
    update: {},
    create: { name: 'Acme Rival (Demo)', slug: 'acme-rival' },
  });

  // --- People ---------------------------------------------------------------

  const owner = await upsertUser('owner@northwind-labs.test', 'Dana Whitfield');
  await upsertMembership(owner.id, northwind.id, Role.OWNER);

  // Multi-org: recruiter at Northwind, interviewer at the rival — the SAME
  // account with different roles per organization.
  const recruiter = await upsertUser(
    'recruiter@northwind-labs.test',
    'Marcus Adeyemi',
  );
  await upsertMembership(recruiter.id, northwind.id, Role.RECRUITER);
  await upsertMembership(recruiter.id, rival.id, Role.INTERVIEWER);

  const rivalOwner = await upsertUser(
    'owner@acme-rival.test',
    'Priya Raghunathan',
  );
  await upsertMembership(rivalOwner.id, rival.id, Role.OWNER);

  const interviewer = await upsertUser(
    'interviewer@northwind-labs.test',
    'Elif Demir',
  );
  await upsertMembership(interviewer.id, northwind.id, Role.INTERVIEWER);

  // Job seeker ONLY: a CandidateAccount, zero memberships. Uzbek locale.
  const seeker = await upsertUser(
    'jasur.toshmatov@example.test',
    'Jasur Toshmatov',
    Locale.uz,
  );
  await prisma.candidateAccount.upsert({
    where: { userId: seeker.id },
    update: {},
    create: {
      userId: seeker.id,
      headline: 'Backend Engineer',
      location: 'Tashkent, UZ',
      phone: '+998 90 000 0100',
      summary:
        'Backend engineer focused on Node.js services, PostgreSQL and queues.',
      skills: ['Node.js', 'TypeScript', 'PostgreSQL', 'Redis'],
      languages: ["O'zbekcha", 'Русский', 'English'],
    },
  });

  // Both sides at once: job seeker AND recruiter at the rival org. Korean
  // locale and Korean profile text (also exercises UTF-8 end to end).
  const dual = await upsertUser('yuna.seo@example.test', '서유나', Locale.ko);
  await upsertMembership(dual.id, rival.id, Role.RECRUITER);
  await prisma.candidateAccount.upsert({
    where: { userId: dual.id },
    update: {},
    create: {
      userId: dual.id,
      headline: '백엔드 엔지니어',
      location: 'Seoul, KR',
      summary: '분산 시스템과 데이터 파이프라인을 다루는 백엔드 엔지니어입니다.',
      skills: ['Kotlin', 'Kubernetes', 'Kafka'],
      languages: ['한국어', 'English'],
    },
  });

  // --- Vacancies --------------------------------------------------------------

  const upsertVacancy = async (data: {
    organizationId: string;
    orgSlug: string;
    title: string;
    status: VacancyStatus;
    createdById: string;
    department?: string;
    location?: string;
    employmentType?: string;
    experienceLevel?: string;
    description?: string;
    requirements?: { text: string; type: RequirementType; required: boolean }[];
  }) => {
    const existing = await prisma.vacancy.findFirst({
      where: { organizationId: data.organizationId, title: data.title },
    });
    if (existing) return existing;
    return prisma.vacancy.create({
      data: {
        organizationId: data.organizationId,
        title: data.title,
        department: data.department,
        location: data.location,
        employmentType: data.employmentType,
        experienceLevel: data.experienceLevel,
        description: data.description,
        status: data.status,
        publicSlug: buildPublicSlug(data.title, data.orgSlug),
        createdById: data.createdById,
        ...(data.requirements
          ? { requirements: { create: data.requirements } }
          : {}),
      },
    });
  };

  const vacancy = await upsertVacancy({
    organizationId: northwind.id,
    orgSlug: northwind.slug,
    title: 'Senior Backend Engineer',
    status: VacancyStatus.OPEN,
    createdById: recruiter.id,
    department: 'Engineering',
    location: 'Tashkent / Remote',
    employmentType: 'Full-time',
    experienceLevel: 'Senior',
    description:
      'Design and operate the services behind our recruitment platform. ' +
      'You will own data modelling, async processing and API design.',
    requirements: [
      { text: '5+ years building production backend services', type: RequirementType.EXPERIENCE, required: true },
      { text: 'TypeScript and Node.js', type: RequirementType.SKILL, required: true },
      { text: 'PostgreSQL schema design and query tuning', type: RequirementType.SKILL, required: true },
      { text: 'Redis and background job queues', type: RequirementType.SKILL, required: false },
      { text: 'BSc in Computer Science or equivalent experience', type: RequirementType.EDUCATION, required: false },
      { text: 'Professional working English', type: RequirementType.LANGUAGE, required: true },
    ],
  });

  // DRAFT on purpose: must never appear on the public board.
  await upsertVacancy({
    organizationId: northwind.id,
    orgSlug: northwind.slug,
    title: 'Platform Engineer (Draft)',
    status: VacancyStatus.DRAFT,
    createdById: owner.id,
    department: 'Engineering',
  });

  await upsertVacancy({
    organizationId: rival.id,
    orgSlug: rival.slug,
    title: 'Data Engineer',
    status: VacancyStatus.OPEN,
    createdById: rivalOwner.id,
    department: 'Data',
    location: 'Seoul / Remote',
    employmentType: 'Full-time',
  });

  // --- Manually uploaded candidates (no CandidateAccount — correct) ---------

  const candidateSeeds = [
    { fullName: 'Aziza Karimova', email: 'aziza.karimova@example.test', phone: '+998 90 000 0001', location: 'Tashkent, UZ', currentTitle: 'Backend Engineer', totalExperienceYears: 6 },
    { fullName: 'Tobias Lindqvist', email: 'tobias.lindqvist@example.test', phone: '+46 70 000 0002', location: 'Stockholm, SE', currentTitle: 'Senior Software Engineer', totalExperienceYears: 9 },
    { fullName: 'Rina Okafor', email: 'rina.okafor@example.test', phone: '+234 80 000 0003', location: 'Lagos, NG', currentTitle: 'Platform Engineer', totalExperienceYears: 4 },
    { fullName: 'Mateo Silva', email: 'mateo.silva@example.test', phone: '+55 11 00000 0004', location: 'São Paulo, BR', currentTitle: 'Full-stack Developer', totalExperienceYears: 3 },
    { fullName: 'Hana Yamamoto', email: 'hana.yamamoto@example.test', phone: '+81 90 0000 0005', location: 'Osaka, JP', currentTitle: 'Staff Engineer', totalExperienceYears: 11 },
  ];

  // Annotated so TypeScript does not infer never[] from the empty literal.
  const candidates: Awaited<ReturnType<typeof prisma.candidate.create>>[] = [];
  for (const seed of candidateSeeds) {
    const existing = await prisma.candidate.findFirst({
      where: { organizationId: northwind.id, email: seed.email },
    });
    candidates.push(
      existing ??
        (await prisma.candidate.create({
          data: { ...seed, organizationId: northwind.id },
        })),
    );
  }

  // A few applications at different human-chosen stages. Nothing here was
  // decided by the system; all were recruiter-created, hence MANUAL_UPLOAD.
  const stages = [
    ApplicationStatus.NEW,
    ApplicationStatus.REVIEWING,
    ApplicationStatus.INTERVIEW,
  ];
  for (const [index, candidate] of candidates.slice(0, 3).entries()) {
    await prisma.application.upsert({
      where: {
        vacancyId_candidateId: { vacancyId: vacancy.id, candidateId: candidate.id },
      },
      update: {},
      create: {
        vacancyId: vacancy.id,
        candidateId: candidate.id,
        status: stages[index],
        source: ApplicationSource.MANUAL_UPLOAD,
      },
    });
  }

  // No documents, evidence or processing jobs are seeded: those only exist as
  // the result of a real upload, and faking them would misrepresent the
  // processing pipeline as having run.
  console.log('Seed complete');
  console.log(`  organization : ${northwind.slug} (${northwind.name})`);
  console.log(`  second org   : ${rival.slug} (for tenant-isolation checks)`);
  console.log(`  owner        : ${owner.email} (OWNER @ northwind)`);
  console.log(`  recruiter    : ${recruiter.email} (RECRUITER @ northwind, INTERVIEWER @ rival)`);
  console.log(`  interviewer  : ${interviewer.email} (INTERVIEWER @ northwind)`);
  console.log(`  job seeker   : ${seeker.email} (CandidateAccount only, uz)`);
  console.log(`  dual persona : ${dual.email} (CandidateAccount + RECRUITER @ rival, ko)`);
  console.log(`  vacancy      : ${vacancy.title} (public slug: ${vacancy.publicSlug})`);
  console.log(`  candidates   : ${candidates.length} (manual, no CandidateAccount)`);
  console.log(`  password     : ${DEV_PASSWORD}  (development only)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
