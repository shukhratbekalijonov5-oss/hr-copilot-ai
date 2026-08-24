import { NotFoundException } from '@nestjs/common';
import { SavedExternalJobsService } from './saved-external-jobs.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CandidatePreferencesService } from '../../candidate-preferences/candidate-preferences.service';
import type { ExternalJobCardService } from './external-job-card.service';
import type { CandidateExternalFlagsService } from './candidate-external-flags.service';

/**
 * Bookmarks: idempotent by construction, owner-scoped in every query, and a
 * reference to the canonical job rather than a copy of it.
 */

const ACCOUNT = 'acct-1';
const JOB = '11111111-1111-4111-8111-111111111111';

function build(options: { jobExists?: boolean } = {}) {
  const upsert = jest.fn().mockResolvedValue({
    createdAt: new Date('2026-08-24T09:00:00.000Z'),
  });
  const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
  const count = jest.fn().mockResolvedValue(0);
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = {
    candidateSavedExternalJob: { upsert, deleteMany, count, findMany },
    externalJob: {
      findUnique: jest
        .fn()
        .mockResolvedValue(options.jobExists === false ? null : { id: JOB }),
    },
  } as unknown as PrismaService;

  const preferences = {
    requireAccountId: jest.fn().mockResolvedValue(ACCOUNT),
  } as unknown as CandidatePreferencesService;

  const loadCards = jest.fn().mockResolvedValue(new Map());
  const cards = { loadCards } as unknown as ExternalJobCardService;

  const flagsFor = jest
    .fn()
    .mockResolvedValue({ saved: new Set<string>(), tracking: new Map() });
  const flags = { flagsFor } as unknown as CandidateExternalFlagsService;

  const service = new SavedExternalJobsService(
    prisma,
    preferences,
    cards,
    flags,
  );
  return { service, upsert, deleteMany, count, findMany, loadCards, flagsFor };
}

describe('saving', () => {
  it('bookmarks by upsert on the composite key, so twice is once', async () => {
    const { service, upsert } = build();
    const result = await service.save('user-1', JOB);

    expect(result).toEqual({
      externalJobId: JOB,
      saved: true,
      savedAt: new Date('2026-08-24T09:00:00.000Z'),
    });
    const call = upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      candidateAccountId_externalJobId: {
        candidateAccountId: ACCOUNT,
        externalJobId: JOB,
      },
    });
    // The idempotence is structural: a repeat matches the unique key and
    // updates NOTHING, so savedAt stays the original save moment.
    expect(call.update).toEqual({});
  });

  it('refuses an id that is not an external job', async () => {
    const { service, upsert } = build({ jobExists: false });
    await expect(service.save('user-1', JOB)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it('unsaves idempotently — the unsaved job is the same success', async () => {
    const { service, deleteMany } = build();
    const result = await service.unsave('user-1', JOB);

    expect(result).toEqual({ externalJobId: JOB, saved: false });
    // deleteMany, not delete: zero rows is a fine answer, not an error.
    expect(deleteMany.mock.calls[0][0].where).toEqual({
      candidateAccountId: ACCOUNT,
      externalJobId: JOB,
    });
  });
});

describe('the saved list', () => {
  it('is owner-scoped, newest-first, with a stable tie-break', async () => {
    const { service, findMany, count } = build();
    await service.list('user-1', { page: 2, pageSize: 10 });

    const call = findMany.mock.calls[0][0];
    expect(call.where).toEqual({ candidateAccountId: ACCOUNT });
    expect(call.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
    expect(call.skip).toBe(10);
    expect(call.take).toBe(10);
    expect(count.mock.calls[0][0].where).toEqual({
      candidateAccountId: ACCOUNT,
    });
  });

  it('decorates rows with canonical cards and the tracking mark, in bulk', async () => {
    const { service, findMany, loadCards, flagsFor } = build();
    const savedAt = new Date('2026-08-24T08:00:00.000Z');
    findMany.mockResolvedValue([
      { externalJobId: 'job-a', createdAt: savedAt },
      { externalJobId: 'job-b', createdAt: savedAt },
    ]);
    loadCards.mockResolvedValue(
      new Map([
        ['job-a', { externalJobId: 'job-a', title: 'A', status: 'CLOSED' }],
        ['job-b', { externalJobId: 'job-b', title: 'B', status: 'ACTIVE' }],
      ]),
    );
    const tracker = { id: 'trk-1', status: 'APPLIED', appliedAt: savedAt };
    flagsFor.mockResolvedValue({
      saved: new Set(['job-a', 'job-b']),
      tracking: new Map([['job-b', tracker]]),
    });

    const page = await service.list('user-1', {});

    // ONE bulk card read and ONE bulk mark read for the page — never per row.
    expect(loadCards).toHaveBeenCalledTimes(1);
    expect(loadCards).toHaveBeenCalledWith(['job-a', 'job-b']);
    expect(flagsFor).toHaveBeenCalledTimes(1);

    // A saved job that has since CLOSED stays listed, honestly labelled.
    expect(page.results[0].status).toBe('CLOSED');
    expect(page.results[0].savedAt).toEqual(savedAt);
    expect(page.results[0].applicationTracking).toBeNull();
    expect(page.results[1].applicationTracking).toEqual(tracker);
  });

  it('never invents a row for a job that no longer exists at all', async () => {
    const { service, findMany, loadCards } = build();
    findMany.mockResolvedValue([
      { externalJobId: 'job-gone', createdAt: new Date() },
    ]);
    loadCards.mockResolvedValue(new Map());

    const page = await service.list('user-1', {});
    expect(page.results).toEqual([]);
  });
});
