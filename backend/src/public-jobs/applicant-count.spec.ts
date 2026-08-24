import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PublicJobsService } from './public-jobs.service';
import { uniqueApplicantCounts } from '../common/vacancy-access/applicant-counts';
import type { PrismaService } from '../prisma/prisma.service';
import type { CandidateAccountService } from '../candidate-account/candidate-account.service';

/**
 * ONE applicant count, shown to both sides of the marketplace.
 *
 * A job page advertising twelve applicants while the recruiter's dashboard
 * reads nine is not a cosmetic bug: a candidate deciding whether it is worth
 * applying is acting on that number. Both surfaces therefore compute it the
 * same way, from the same function, live.
 *
 * "One candidate is one applicant" is the whole subtlety. Re-applying after a
 * rejection creates a second application row on purpose — the attempt history
 * is real and every attempt-level endpoint still returns all of it — but the
 * headline number counts PEOPLE, so it must not move.
 */

const VACANCY = { id: 'vac-1', publicSlug: 'backend-engineer' };

function prismaWith(pairs: { vacancyId: string; candidateId: string }[]) {
  return {
    application: { findMany: jest.fn().mockResolvedValue(pairs) },
    vacancy: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { ...VACANCY, title: 'Backend Engineer', createdAt: new Date() },
        ]),
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue({
        ...VACANCY,
        title: 'Backend Engineer',
        requirements: [],
        languages: [],
      }),
    },
    $transaction: jest.fn((arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : Promise.resolve(null),
    ),
  };
}

function build(pairs: { vacancyId: string; candidateId: string }[]) {
  const prisma = prismaWith(pairs);
  const service = new PublicJobsService(
    prisma as unknown as PrismaService,
    {} as unknown as CandidateAccountService,
    { publish: jest.fn() } as never,
    { current: jest.fn().mockResolvedValue({ table: null }) } as never,
  );
  return { service, prisma };
}

describe('one candidate is one applicant', () => {
  it('counts people, not attempts', async () => {
    // `distinct` is asked of the database; the tally here is over what came
    // back. Three rows, two people.
    const counts = await uniqueApplicantCounts(
      {
        application: {
          findMany: () =>
            Promise.resolve([
              { vacancyId: 'vac-1', candidateId: 'cand-a' },
              { vacancyId: 'vac-1', candidateId: 'cand-b' },
            ]),
        },
      } as never,
      ['vac-1'],
    );

    expect(counts.get('vac-1')).toBe(2);
  });

  it('asks the database for DISTINCT (vacancy, candidate) pairs', async () => {
    // The guard against double-counting a re-application lives in the query.
    // Without `distinct` a person who applied, was rejected and applied again
    // would be two applicants on every surface at once.
    const findMany = jest.fn().mockResolvedValue([]);
    await uniqueApplicantCounts({ application: { findMany } } as never, [
      'vac-1',
    ]);

    expect(findMany.mock.calls[0][0].distinct).toEqual([
      'vacancyId',
      'candidateId',
    ]);
  });

  it('counts only genuine applications', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await uniqueApplicantCounts({ application: { findMany } } as never, [
      'vac-1',
    ]);

    const where = findMany.mock.calls[0][0].where;
    expect(where.source).toBe('DIRECT');
    expect(where.candidate).toEqual({ candidateAccountId: { not: null } });
  });

  it('asks nothing at all for an empty page', async () => {
    const findMany = jest.fn();
    expect(
      (await uniqueApplicantCounts({ application: { findMany } } as never, []))
        .size,
    ).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('a vacancy nobody applied to reports zero, not absent', async () => {
    const { service } = build([]);

    const { data } = await service.list({
      page: 1,
      limit: 20,
      skip: 0,
    });

    expect((data as { applicantCount: number }[])[0].applicantCount).toBe(0);
  });
});

describe("the candidate sees the recruiter's number", () => {
  it('the job list carries it', async () => {
    const { service } = build([
      { vacancyId: 'vac-1', candidateId: 'cand-a' },
      { vacancyId: 'vac-1', candidateId: 'cand-b' },
    ]);

    const { data } = await service.list({
      page: 1,
      limit: 20,
      skip: 0,
    });

    expect((data as { applicantCount: number }[])[0].applicantCount).toBe(2);
  });

  it('the job detail page carries it', async () => {
    const { service } = build([{ vacancyId: 'vac-1', candidateId: 'cand-a' }]);

    const detail = (await service.detail('backend-engineer')) as unknown as {
      applicantCount: number;
    };

    expect(detail.applicantCount).toBe(1);
  });

  it('and only the number — never who applied', async () => {
    const { service } = build([
      { vacancyId: 'vac-1', candidateId: 'cand-secret' },
    ]);

    const { data } = await service.list({
      page: 1,
      limit: 20,
      skip: 0,
    });
    const payload = JSON.stringify(data);

    expect(payload).not.toContain('cand-secret');
    expect(payload).not.toContain('candidateId');
    expect(payload).not.toContain('applications');
  });

  it('recruiter and candidate share ONE implementation', () => {
    // Structural, on purpose. Two correct implementations of "how many people
    // applied" drift the moment one of them learns about a new status or
    // source, and the disagreement shows up as the two sides of the
    // marketplace being told different things.
    const root = join(__dirname, '..');
    const vacancies = readFileSync(
      join(root, 'vacancies/vacancies.service.ts'),
      'utf8',
    );
    const publicJobs = readFileSync(
      join(root, 'public-jobs/public-jobs.service.ts'),
      'utf8',
    );

    expect(vacancies).toContain('uniqueApplicantCounts');
    expect(publicJobs).toContain('uniqueApplicantCounts');
    // Neither may hand-roll the distinct-pair query beside it.
    for (const source of [vacancies, publicJobs]) {
      expect(source).not.toContain("distinct: ['vacancyId', 'candidateId']");
    }
  });
});
