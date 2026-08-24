import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ExternalApplicationTrackingService } from './external-application-tracking.service';
import { ALREADY_TRACKED_CODE } from './external-application.policy';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CandidatePreferencesService } from '../../candidate-preferences/candidate-preferences.service';
import type { ExternalJobCardService } from './external-job-card.service';
import type { CandidateExternalFlagsService } from './candidate-external-flags.service';

/**
 * Self-reported application tracking: the candidate is the only writer, the
 * tracker survives the job's lifecycle, and nothing here can reach the
 * internal Application model.
 */

const ACCOUNT = 'acct-1';
const JOB = '11111111-1111-4111-8111-111111111111';
const TRACKER = '22222222-2222-4222-8222-222222222222';

function trackerRow(over: Record<string, unknown> = {}) {
  return {
    id: TRACKER,
    candidateAccountId: ACCOUNT,
    externalJobId: JOB,
    status: 'APPLIED',
    appliedAt: new Date('2026-08-20T12:00:00.000Z'),
    note: null,
    createdAt: new Date('2026-08-20T12:00:00.000Z'),
    updatedAt: new Date('2026-08-20T12:00:00.000Z'),
    ...over,
  };
}

function build(options: { jobExists?: boolean } = {}) {
  const create = jest.fn().mockResolvedValue(trackerRow());
  const update = jest.fn().mockResolvedValue(trackerRow());
  const del = jest.fn().mockResolvedValue(trackerRow());
  const findFirst = jest.fn().mockResolvedValue({ id: TRACKER });
  const findUnique = jest.fn().mockResolvedValue({ id: TRACKER });
  const count = jest.fn().mockResolvedValue(0);
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = {
    candidateExternalJobApplication: {
      create,
      update,
      delete: del,
      findFirst,
      findUnique,
      count,
      findMany,
    },
    externalJob: {
      findUnique: jest
        .fn()
        .mockResolvedValue(options.jobExists === false ? null : { id: JOB }),
    },
    // Deliberately NO `application` key: if this service ever touched the
    // internal Application model, these tests would throw on an undefined
    // property before any assertion ran.
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

  const service = new ExternalApplicationTrackingService(
    prisma,
    preferences,
    cards,
    flags,
  );
  return {
    service,
    create,
    update,
    del,
    findFirst,
    count,
    findMany,
    loadCards,
    flagsFor,
  };
}

describe('marking applied', () => {
  it('records exactly what the candidate stated, defaulting honestly', async () => {
    const { service, create } = build();
    await service.track('user-1', JOB, {});

    const data = create.mock.calls[0][0].data;
    expect(data.candidateAccountId).toBe(ACCOUNT);
    expect(data.externalJobId).toBe(JOB);
    expect(data.status).toBe('APPLIED');
    expect(data.note).toBeNull();
    // Defaults to "now" — the moment they marked it, not a provider signal.
    expect(Math.abs(data.appliedAt.getTime() - Date.now())).toBeLessThan(5000);
  });

  it('keeps the candidate-stated appliedAt when it is a past moment', async () => {
    const { service, create } = build();
    await service.track('user-1', JOB, {
      appliedAt: '2026-08-01T10:00:00.000Z',
    });
    expect(create.mock.calls[0][0].data.appliedAt).toEqual(
      new Date('2026-08-01T10:00:00.000Z'),
    );
  });

  it('refuses a future appliedAt — an application is a past event', async () => {
    const { service, create } = build();
    await expect(
      service.track('user-1', JOB, {
        appliedAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('trims the note and stores emptiness as null', async () => {
    const { service, create } = build();
    await service.track('user-1', JOB, { note: '   ' });
    expect(create.mock.calls[0][0].data.note).toBeNull();

    await service.track('user-1', JOB, { note: '  via referral  ' });
    expect(create.mock.calls[1][0].data.note).toBe('via referral');
  });

  it('is a 404 for an id that is not an external job', async () => {
    const { service, create } = build({ jobExists: false });
    await expect(service.track('user-1', JOB, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('answers a duplicate with a 409 pointing at the existing tracker', async () => {
    const { service, create } = build();
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const failure = service.track('user-1', JOB, {});
    await expect(failure).rejects.toBeInstanceOf(ConflictException);
    await failure.catch((error: ConflictException) => {
      // The stable code plus the id to PATCH — never a silent overwrite of
      // the candidate's earlier record.
      expect(error.getResponse()).toMatchObject({
        message: ALREADY_TRACKED_CODE,
        trackingId: TRACKER,
      });
    });
  });
});

describe('correcting and removing', () => {
  it('updates only the fields the candidate sent', async () => {
    const { service, update } = build();
    await service.update('user-1', TRACKER, { status: 'INTERVIEW' });

    expect(update.mock.calls[0][0]).toEqual({
      where: { id: TRACKER },
      data: { status: 'INTERVIEW' },
    });
  });

  it('clears the note on an explicit null, leaves it alone when omitted', async () => {
    const { service, update } = build();
    await service.update('user-1', TRACKER, { note: null });
    expect(update.mock.calls[0][0].data).toEqual({ note: null });

    await service.update('user-1', TRACKER, { status: 'REJECTED' });
    expect(update.mock.calls[1][0].data).not.toHaveProperty('note');
  });

  it("is a 404 for another candidate's tracker, same as for none", async () => {
    const { service, findFirst, update } = build();
    findFirst.mockResolvedValue(null);

    await expect(
      service.update('user-1', TRACKER, { status: 'OFFER' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('user-1', TRACKER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(update).not.toHaveBeenCalled();
    // The ownership probe carries the caller's OWN account id, so a foreign
    // tracker is indistinguishable from an absent one.
    expect(findFirst.mock.calls[0][0].where).toEqual({
      id: TRACKER,
      candidateAccountId: ACCOUNT,
    });
  });

  it('deletes an owned tracker and says so plainly', async () => {
    const { service, del } = build();
    await expect(service.remove('user-1', TRACKER)).resolves.toEqual({
      id: TRACKER,
      deleted: true,
    });
    expect(del).toHaveBeenCalledWith({ where: { id: TRACKER } });
  });
});

describe('the tracking list', () => {
  it('is owner-scoped, newest-applied-first, optionally one status', async () => {
    const { service, findMany, count } = build();
    await service.list('user-1', { status: 'INTERVIEW', page: 3, pageSize: 5 });

    const call = findMany.mock.calls[0][0];
    expect(call.where).toEqual({
      candidateAccountId: ACCOUNT,
      status: 'INTERVIEW',
    });
    expect(call.orderBy).toEqual([{ appliedAt: 'desc' }, { id: 'asc' }]);
    expect(call.skip).toBe(10);
    expect(call.take).toBe(5);
    expect(count.mock.calls[0][0].where).toEqual(call.where);
  });

  it('keeps the tracker when the job has since closed, honestly labelled', async () => {
    const { service, findMany, loadCards } = build();
    findMany.mockResolvedValue([trackerRow()]);
    loadCards.mockResolvedValue(
      new Map([[JOB, { externalJobId: JOB, title: 'Gone', status: 'CLOSED' }]]),
    );

    const page = await service.list('user-1', {});
    // The candidate applied while it was open. The row remains; the job's
    // CURRENT status travels with it rather than being softened or hidden.
    expect(page.results[0].status).toBe('APPLIED');
    expect(page.results[0].job?.status).toBe('CLOSED');
  });

  it('marks whether each tracked job is also saved — independent concepts', async () => {
    const { service, findMany, loadCards, flagsFor } = build();
    findMany.mockResolvedValue([trackerRow()]);
    loadCards.mockResolvedValue(
      new Map([[JOB, { externalJobId: JOB, title: 'T', status: 'ACTIVE' }]]),
    );
    flagsFor.mockResolvedValue({
      saved: new Set<string>(),
      tracking: new Map(),
    });

    const page = await service.list('user-1', {});
    // Tracked but not saved: neither implies the other, ever.
    expect(page.results[0].job?.saved).toBe(false);
  });
});
