/**
 * Development seed data.
 *
 * Everything below is invented for local development. No real candidate,
 * employee or applicant data may ever be placed in this file — it is committed
 * to the repository and shared with every contributor.
 *
 * The cast deliberately exercises every identity shape the product supports.
 * Account types are EXCLUSIVE — a user is either a CANDIDATE or an
 * ORGANIZATION account, never both (see AccountTypeService):
 *   - ORGANIZATION accounts: owner / recruiter / interviewer memberships,
 *     including one user with memberships in TWO organizations under
 *     different roles (multi-org stays supported within the type)
 *   - CANDIDATE accounts: job seekers with a CandidateAccount and, by
 *     invariant, zero memberships
 *   - a rival organization so tenant isolation stays testable by hand
 *
 * Run with: npm run db:seed
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  AccountType,
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
    accountType: AccountType,
    preferredLocale: Locale = Locale.en,
  ) =>
    prisma.user.upsert({
      where: { email },
      // accountType is part of `update` too: pre-exclusivity rows must land
      // on the type this cast now assigns them.
      update: { accountType },
      create: { email, passwordHash, fullName, accountType, preferredLocale },
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

  const owner = await upsertUser(
    'owner@northwind-labs.test',
    'Dana Whitfield',
    AccountType.ORGANIZATION,
  );
  await upsertMembership(owner.id, northwind.id, Role.OWNER);

  // Multi-org: recruiter at Northwind, interviewer at the rival — the SAME
  // account with different roles per organization. Multi-org membership
  // remains fully supported for ORGANIZATION accounts.
  const recruiter = await upsertUser(
    'recruiter@northwind-labs.test',
    'Marcus Adeyemi',
    AccountType.ORGANIZATION,
  );
  await upsertMembership(recruiter.id, northwind.id, Role.RECRUITER);
  await upsertMembership(recruiter.id, rival.id, Role.INTERVIEWER);

  const rivalOwner = await upsertUser(
    'owner@acme-rival.test',
    'Priya Raghunathan',
    AccountType.ORGANIZATION,
  );
  await upsertMembership(rivalOwner.id, rival.id, Role.OWNER);

  const interviewer = await upsertUser(
    'interviewer@northwind-labs.test',
    'Elif Demir',
    AccountType.ORGANIZATION,
  );
  await upsertMembership(interviewer.id, northwind.id, Role.INTERVIEWER);

  // CANDIDATE: a CandidateAccount, zero memberships (by invariant). Uzbek locale.
  const seeker = await upsertUser(
    'jasur.toshmatov@example.test',
    'Jasur Toshmatov',
    AccountType.CANDIDATE,
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

  // Second CANDIDATE, Korean locale and Korean profile text (exercises UTF-8
  // end to end). Historically this persona was ALSO a recruiter at the rival
  // org — dual identity is no longer a legal shape, so she is a candidate
  // only now (converted in the dev DB by scripts/resolve-dual-identity.ts).
  const seekerKo = await upsertUser(
    'yuna.seo@example.test',
    '서유나',
    AccountType.CANDIDATE,
    Locale.ko,
  );
  await prisma.candidateAccount.upsert({
    where: { userId: seekerKo.id },
    update: {},
    create: {
      userId: seekerKo.id,
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

  // --- Applicants: real people who applied themselves -----------------------
  //
  // The ONLY way a candidate enters a recruiter's pipeline is by applying, so
  // the seed mirrors that shape: a User with a CandidateAccount, an org-side
  // Candidate LINKED to that account, and a DIRECT application. Recruiters can
  // no longer create candidates, so seeding an accountless one would fabricate
  // a state the product cannot produce (and every applicant surface filters
  // such rows out anyway).

  const applicantSeeds = [
    { email: 'aziza.karimova@example.test', fullName: 'Aziza Karimova', locale: Locale.uz, phone: '+998 90 000 0001', location: 'Tashkent, UZ', headline: 'Backend Engineer', years: 6, status: ApplicationStatus.NEW },
    { email: 'tobias.lindqvist@example.test', fullName: 'Tobias Lindqvist', locale: Locale.en, phone: '+46 70 000 0002', location: 'Stockholm, SE', headline: 'Senior Software Engineer', years: 9, status: ApplicationStatus.REVIEWING },
    { email: 'rina.okafor@example.test', fullName: 'Rina Okafor', locale: Locale.en, phone: '+234 80 000 0003', location: 'Lagos, NG', headline: 'Platform Engineer', years: 4, status: ApplicationStatus.NEW },
  ];

  const applicants: string[] = [];
  for (const seed of applicantSeeds) {
    const user = await upsertUser(
      seed.email,
      seed.fullName,
      AccountType.CANDIDATE,
      seed.locale,
    );
    const account = await prisma.candidateAccount.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        headline: seed.headline,
        location: seed.location,
        phone: seed.phone,
      },
      select: { id: true },
    });
    const candidate = await prisma.candidate.upsert({
      where: {
        organizationId_candidateAccountId: {
          organizationId: northwind.id,
          candidateAccountId: account.id,
        },
      },
      update: {},
      create: {
        organizationId: northwind.id,
        candidateAccountId: account.id,
        fullName: seed.fullName,
        email: seed.email,
        phone: seed.phone,
        location: seed.location,
        currentTitle: seed.headline,
        totalExperienceYears: seed.years,
      },
      select: { id: true },
    });
    // Stages differ so the pipeline UI has something to show; a human moved
    // each one — nothing here was decided by the system.
    // Idempotent by hand rather than by upsert: (vacancy, candidate) is no
    // longer a unique key — a candidate may hold several attempts once an
    // earlier one was rejected — so there is no compound id to upsert on.
    const existingApplication = await prisma.application.findFirst({
      where: { vacancyId: vacancy.id, candidateId: candidate.id },
      select: { id: true },
    });
    if (!existingApplication) {
      await prisma.application.create({
        data: {
          vacancyId: vacancy.id,
          candidateId: candidate.id,
          status: seed.status,
          source: ApplicationSource.DIRECT,
        },
      });
    }
    applicants.push(candidate.id);
  }

  // No documents, evidence or processing jobs are seeded: those only exist as
  // the result of a real application upload, and faking them would
  // misrepresent the processing pipeline as having run. Use
  // `npm run seed:synthetic` for a dataset that goes through the real apply
  // path end to end.
  console.log('Seed complete');
  console.log(`  organization : ${northwind.slug} (${northwind.name})`);
  console.log(`  second org   : ${rival.slug} (for tenant-isolation checks)`);
  console.log(`  owner        : ${owner.email} (ORGANIZATION, OWNER @ northwind)`);
  console.log(`  recruiter    : ${recruiter.email} (ORGANIZATION, RECRUITER @ northwind, INTERVIEWER @ rival)`);
  console.log(`  interviewer  : ${interviewer.email} (ORGANIZATION, INTERVIEWER @ northwind)`);
  console.log(`  job seeker   : ${seeker.email} (CANDIDATE, uz)`);
  console.log(`  job seeker 2 : ${seekerKo.email} (CANDIDATE, ko)`);
  console.log(`  vacancy      : ${vacancy.title} (public slug: ${vacancy.publicSlug})`);
  console.log(`  applicants   : ${applicants.length} (CandidateAccount + DIRECT application)`);
  console.log(`  password     : ${DEV_PASSWORD}  (development only)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
