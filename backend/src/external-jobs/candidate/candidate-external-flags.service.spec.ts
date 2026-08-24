import { CandidateExternalFlagsService } from './candidate-external-flags.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * The one bulk lookup every card-decorating surface shares: two indexed IN
 * queries per page, owner-scoped, and silent about everyone else's marks.
 */

const ACCOUNT = 'acct-1';

function build() {
  const savedFindMany = jest.fn().mockResolvedValue([]);
  const trackerFindMany = jest.fn().mockResolvedValue([]);
  const prisma = {
    candidateSavedExternalJob: { findMany: savedFindMany },
    candidateExternalJobApplication: { findMany: trackerFindMany },
  } as unknown as PrismaService;
  return {
    service: new CandidateExternalFlagsService(prisma),
    savedFindMany,
    trackerFindMany,
  };
}

describe('CandidateExternalFlagsService', () => {
  it('runs zero queries for an empty page', async () => {
    const { service, savedFindMany, trackerFindMany } = build();
    const flags = await service.flagsFor(ACCOUNT, []);

    expect(flags.saved.size).toBe(0);
    expect(flags.tracking.size).toBe(0);
    expect(savedFindMany).not.toHaveBeenCalled();
    expect(trackerFindMany).not.toHaveBeenCalled();
  });

  it('asks two bulk questions per page, both owner-scoped', async () => {
    const { service, savedFindMany, trackerFindMany } = build();
    await service.flagsFor(ACCOUNT, ['job-a', 'job-b', 'job-c']);

    // One query per table for the WHOLE page — the N+1 this exists to
    // prevent would show up here as three calls each.
    expect(savedFindMany).toHaveBeenCalledTimes(1);
    expect(trackerFindMany).toHaveBeenCalledTimes(1);
    for (const call of [
      savedFindMany.mock.calls[0][0],
      trackerFindMany.mock.calls[0][0],
    ]) {
      expect(call.where).toEqual({
        candidateAccountId: ACCOUNT,
        externalJobId: { in: ['job-a', 'job-b', 'job-c'] },
      });
    }
  });

  it('maps marks by job id and claims nothing about unmarked jobs', async () => {
    const { service, savedFindMany, trackerFindMany } = build();
    savedFindMany.mockResolvedValue([{ externalJobId: 'job-a' }]);
    const appliedAt = new Date('2026-08-20T12:00:00.000Z');
    trackerFindMany.mockResolvedValue([
      { id: 'trk-1', externalJobId: 'job-b', status: 'INTERVIEW', appliedAt },
    ]);

    const flags = await service.flagsFor(ACCOUNT, ['job-a', 'job-b', 'job-c']);

    expect(flags.saved.has('job-a')).toBe(true);
    expect(flags.saved.has('job-b')).toBe(false);
    expect(flags.tracking.get('job-b')).toEqual({
      id: 'trk-1',
      status: 'INTERVIEW',
      appliedAt,
    });
    // job-c carries no mark of either kind — saved and tracked stay
    // independent answers, never inferred from one another.
    expect(flags.saved.has('job-c')).toBe(false);
    expect(flags.tracking.has('job-c')).toBe(false);
  });
});
