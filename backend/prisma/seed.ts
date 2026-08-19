/**
 * Development seed data.
 *
 * Everything below is invented for local development. No real candidate,
 * employee or applicant data may ever be placed in this file — it is committed
 * to the repository and shared with every contributor.
 *
 * Run with: yarn db:seed
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  ApplicationStatus,
  RequirementType,
  Role,
  VacancyStatus,
} from '../src/generated/prisma/enums';

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

  const organization = await prisma.organization.upsert({
    where: { slug: 'northwind-labs' },
    update: {},
    create: { name: 'Northwind Labs (Demo)', slug: 'northwind-labs' },
  });

  const owner = await prisma.user.upsert({
    where: { email: 'owner@northwind-labs.test' },
    update: {},
    create: {
      email: 'owner@northwind-labs.test',
      passwordHash,
      fullName: 'Dana Whitfield',
      role: Role.OWNER,
      organizationId: organization.id,
    },
  });

  const recruiter = await prisma.user.upsert({
    where: { email: 'recruiter@northwind-labs.test' },
    update: {},
    create: {
      email: 'recruiter@northwind-labs.test',
      passwordHash,
      fullName: 'Marcus Adeyemi',
      role: Role.RECRUITER,
      organizationId: organization.id,
    },
  });

  // A second organization exists purely so tenant-isolation can be exercised
  // by hand in development — its data must never be visible to the first.
  const otherOrg = await prisma.organization.upsert({
    where: { slug: 'acme-rival' },
    update: {},
    create: { name: 'Acme Rival (Demo)', slug: 'acme-rival' },
  });
  await prisma.user.upsert({
    where: { email: 'owner@acme-rival.test' },
    update: {},
    create: {
      email: 'owner@acme-rival.test',
      passwordHash,
      fullName: 'Priya Raghunathan',
      role: Role.OWNER,
      organizationId: otherOrg.id,
    },
  });

  const existingVacancy = await prisma.vacancy.findFirst({
    where: { organizationId: organization.id, title: 'Senior Backend Engineer' },
  });

  const vacancy =
    existingVacancy ??
    (await prisma.vacancy.create({
      data: {
        organizationId: organization.id,
        title: 'Senior Backend Engineer',
        department: 'Engineering',
        location: 'Tashkent / Remote',
        employmentType: 'Full-time',
        experienceLevel: 'Senior',
        description:
          'Design and operate the services behind our recruitment platform. ' +
          'You will own data modelling, async processing and API design.',
        status: VacancyStatus.OPEN,
        createdById: recruiter.id,
        requirements: {
          create: [
            { text: '5+ years building production backend services', type: RequirementType.EXPERIENCE, required: true },
            { text: 'TypeScript and Node.js', type: RequirementType.SKILL, required: true },
            { text: 'PostgreSQL schema design and query tuning', type: RequirementType.SKILL, required: true },
            { text: 'Redis and background job queues', type: RequirementType.SKILL, required: false },
            { text: 'BSc in Computer Science or equivalent experience', type: RequirementType.EDUCATION, required: false },
            { text: 'Professional working English', type: RequirementType.LANGUAGE, required: true },
          ],
        },
      },
    }));

  // Fictional candidates — invented names, .test email addresses.
  const candidateSeeds = [
    { fullName: 'Aziza Karimova', email: 'aziza.karimova@example.test', phone: '+998 90 000 0001', location: 'Tashkent, UZ', currentTitle: 'Backend Engineer', totalExperienceYears: 6 },
    { fullName: 'Tobias Lindqvist', email: 'tobias.lindqvist@example.test', phone: '+46 70 000 0002', location: 'Stockholm, SE', currentTitle: 'Senior Software Engineer', totalExperienceYears: 9 },
    { fullName: 'Rina Okafor', email: 'rina.okafor@example.test', phone: '+234 80 000 0003', location: 'Lagos, NG', currentTitle: 'Platform Engineer', totalExperienceYears: 4 },
    { fullName: 'Mateo Silva', email: 'mateo.silva@example.test', phone: '+55 11 00000 0004', location: 'São Paulo, BR', currentTitle: 'Full-stack Developer', totalExperienceYears: 3 },
    { fullName: 'Hana Yamamoto', email: 'hana.yamamoto@example.test', phone: '+81 90 0000 0005', location: 'Osaka, JP', currentTitle: 'Staff Engineer', totalExperienceYears: 11 },
  ];

  const candidates = [];
  for (const seed of candidateSeeds) {
    const existing = await prisma.candidate.findFirst({
      where: { organizationId: organization.id, email: seed.email },
    });
    candidates.push(
      existing ??
        (await prisma.candidate.create({
          data: { ...seed, organizationId: organization.id },
        })),
    );
  }

  // A few applications at different human-chosen stages. Nothing here was
  // decided by the system.
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
      },
    });
  }

  // No documents, evidence or processing jobs are seeded: those only exist as
  // the result of a real upload, and faking them would misrepresent the
  // processing pipeline as having run.
  console.log('Seed complete');
  console.log(`  organization : ${organization.slug} (${organization.name})`);
  console.log(`  owner        : ${owner.email}`);
  console.log(`  recruiter    : ${recruiter.email}`);
  console.log(`  second org   : ${otherOrg.slug} (for tenant-isolation checks)`);
  console.log(`  vacancy      : ${vacancy.title}`);
  console.log(`  candidates   : ${candidates.length}`);
  console.log(`  password     : ${DEV_PASSWORD}  (development only)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
