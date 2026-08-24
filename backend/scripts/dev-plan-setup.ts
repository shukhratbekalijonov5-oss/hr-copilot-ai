/**
 * DEV/TEST ONLY — enforce the temporary candidate plan fixture.
 *
 *   npm run dev:plan-setup
 *
 * Sets the two designated development test accounts and normalizes every
 * other CANDIDATE account to FREE:
 *
 *   shukhratbekalijonov9@gmail.com → MAX
 *   shukhratbekalijonov7@gmail.com → PRO
 *   every other candidate account  → FREE
 *
 * This is the operator arm of the TRANSITIONAL plan source
 * (candidate_accounts.plan — see docs/candidate-plans.md). It exists so the
 * fixture is repeatable instead of a remembered SQL snippet; once the Java
 * Payment Service owns subscription state, plan changes flow through it and
 * this script is deleted.
 *
 * Safety properties, all deliberate:
 *  - idempotent: running it twice is the same as once (it writes target
 *    states, not deltas, and reports what actually changed);
 *  - refuses to run outside development (NODE_ENV production is a hard stop);
 *  - touches ONLY candidate accounts — an HR/org user with one of these
 *    emails would be reported and skipped, never converted;
 *  - creates nothing: a missing designated account is a loud report line,
 *    not an implicit user creation;
 *  - no secrets, no passwords, no HTTP surface.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const DESIGNATED: Record<string, 'PRO' | 'MAX'> = {
  'shukhratbekalijonov9@gmail.com': 'MAX',
  'shukhratbekalijonov7@gmail.com': 'PRO',
};

async function main(): Promise<void> {
  const logger = new Logger('DevPlanSetup');
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'dev-plan-setup is a development fixture and never runs in production',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const prisma = app.get(PrismaService);

  try {
    for (const [email, plan] of Object.entries(DESIGNATED)) {
      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          accountType: true,
          candidateAccount: { select: { id: true, plan: true } },
        },
      });
      if (!user) {
        logger.warn(`MISSING  ${email} — no such user; nothing created`);
        continue;
      }
      if (user.accountType !== 'CANDIDATE' || !user.candidateAccount) {
        logger.warn(
          `SKIPPED  ${email} — accountType=${user.accountType}, not a candidate; never converted`,
        );
        continue;
      }
      if (user.candidateAccount.plan === plan) {
        logger.log(`OK       ${email} already ${plan}`);
      } else {
        await prisma.candidateAccount.update({
          where: { id: user.candidateAccount.id },
          data: { plan },
        });
        logger.log(`SET      ${email} ${user.candidateAccount.plan} → ${plan}`);
      }
    }

    // Everyone else: FREE. Scoped to candidate accounts by construction —
    // the table only holds candidate accounts — and excludes the designated
    // pair by their (verified-candidate) emails.
    const normalized = await prisma.candidateAccount.updateMany({
      where: {
        plan: { not: 'FREE' },
        user: { email: { notIn: Object.keys(DESIGNATED) } },
      },
      data: { plan: 'FREE' },
    });
    logger.log(`NORMALIZED ${normalized.count} other account(s) to FREE`);

    const distribution = await prisma.candidateAccount.groupBy({
      by: ['plan'],
      _count: true,
    });
    for (const row of distribution.sort((a, b) =>
      a.plan.localeCompare(b.plan),
    )) {
      logger.log(`FINAL    ${row.plan} = ${row._count}`);
    }
  } finally {
    await app.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
