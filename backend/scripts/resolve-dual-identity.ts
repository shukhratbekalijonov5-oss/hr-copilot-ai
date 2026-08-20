/**
 * Dual-identity resolution tool for the accountType migration.
 *
 * The 20260821000000_account_type_exclusivity migration refuses to backfill
 * `users.accountType` while any user still holds BOTH a CandidateAccount and
 * OrganizationMember rows — it will not guess which side of a person's data
 * to keep. This script is the documented, explicit resolution path.
 *
 *   Report only (no writes):
 *     npx ts-node --compiler-options '{"module":"CommonJS"}' \
 *       scripts/resolve-dual-identity.ts
 *
 *   Resolve one user (destructive — removes the OTHER side):
 *     npx ts-node --compiler-options '{"module":"CommonJS"}' \
 *       scripts/resolve-dual-identity.ts --email x@y.z --keep CANDIDATE --apply
 *
 * What "resolve" deletes:
 *   --keep CANDIDATE      deletes the user's OrganizationMember rows ONLY.
 *                         Organizations and all their tenant data survive; an
 *                         organization left with no members is reported so it
 *                         can be handled deliberately.
 *   --keep ORGANIZATION   deletes the user's CandidateAccount, which cascades
 *                         to their saved jobs and personal documents. Org-side
 *                         Candidate rows survive (candidateAccountId becomes
 *                         NULL by ON DELETE SET NULL); application snapshots
 *                         are org-owned copies and are untouched.
 *
 * Without --apply the script prints what WOULD be deleted and exits non-zero,
 * so it can never destroy data as a side effect of being run casually.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

interface Args {
  email?: string;
  keep?: 'CANDIDATE' | 'ORGANIZATION';
  apply: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--email') args.email = argv[++i];
    else if (argv[i] === '--keep') {
      const v = argv[++i];
      if (v !== 'CANDIDATE' && v !== 'ORGANIZATION') {
        throw new Error(`--keep must be CANDIDATE or ORGANIZATION, got ${v}`);
      }
      args.keep = v;
    } else if (argv[i] === '--apply') args.apply = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

/**
 * Explicit `select` everywhere (never `include`): this script runs BEFORE the
 * accountType migration, so the generated client's default selection set
 * would ask for a column the database does not have yet.
 */
const DUAL_USER_SELECT = {
  id: true,
  email: true,
  candidateAccount: {
    select: {
      id: true,
      resumeDocumentId: true,
      _count: { select: { savedJobs: true, personalDocuments: true } },
    },
  },
  memberships: {
    select: {
      id: true,
      role: true,
      organizationId: true,
      organization: { select: { name: true, slug: true } },
    },
  },
} as const;

const dualUsers = () =>
  prisma.user.findMany({
    where: {
      AND: [
        { candidateAccount: { isNot: null } },
        { memberships: { some: {} } },
      ],
    },
    select: DUAL_USER_SELECT,
  });

async function report() {
  const users = await dualUsers();
  if (users.length === 0) {
    console.log(
      'No dual-identity users. The accountType migration can proceed.',
    );
    return;
  }
  console.log(`${users.length} dual-identity user(s) need resolution:\n`);
  for (const u of users) {
    const ca = u.candidateAccount!;
    console.log(`  ${u.email}`);
    console.log(
      `    candidate side: resume=${ca.resumeDocumentId ? 'yes' : 'no'}, ` +
        `savedJobs=${ca._count.savedJobs}, personalDocuments=${ca._count.personalDocuments}`,
    );
    for (const m of u.memberships) {
      console.log(
        `    membership: ${m.role} of "${m.organization.name}" (${m.organization.slug})`,
      );
    }
  }
  console.log(
    '\nResolve each with: --email <email> --keep CANDIDATE|ORGANIZATION --apply',
  );
  process.exitCode = 1;
}

async function resolve(email: string, keep: Args['keep'], apply: boolean) {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: DUAL_USER_SELECT,
  });
  if (!user) throw new Error(`No user with email ${email}`);
  if (!user.candidateAccount || user.memberships.length === 0) {
    console.log(`${email} is not a dual-identity user — nothing to resolve.`);
    return;
  }

  if (keep === 'CANDIDATE') {
    console.log(
      `${apply ? 'Deleting' : 'Would delete'} ${user.memberships.length} membership(s) of ${email}:`,
    );
    for (const m of user.memberships) {
      const remaining = await prisma.organizationMember.count({
        where: { organizationId: m.organizationId, id: { not: m.id } },
      });
      console.log(
        `  ${m.role} of "${m.organization.name}" — organization keeps ${remaining} member(s)` +
          (remaining === 0 ? '  ⚠ organization becomes member-less' : ''),
      );
    }
    if (apply) {
      await prisma.organizationMember.deleteMany({
        where: { userId: user.id },
      });
      console.log(`Resolved: ${email} keeps the CANDIDATE identity.`);
    }
  } else {
    const ca = user.candidateAccount;
    console.log(
      `${apply ? 'Deleting' : 'Would delete'} the CandidateAccount of ${email}: ` +
        `resume=${ca.resumeDocumentId ? 'yes' : 'no'}, savedJobs=${ca._count.savedJobs}, ` +
        `personalDocuments=${ca._count.personalDocuments} (all cascade away)`,
    );
    if (apply) {
      await prisma.candidateAccount.delete({ where: { id: ca.id } });
      console.log(`Resolved: ${email} keeps the ORGANIZATION identity.`);
    }
  }
  if (!apply) {
    console.log('Dry run — re-run with --apply to execute.');
    process.exitCode = 1;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email && !args.keep) {
    await report();
  } else if (args.email && args.keep) {
    await resolve(args.email, args.keep, args.apply);
  } else {
    throw new Error('--email and --keep must be provided together');
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
