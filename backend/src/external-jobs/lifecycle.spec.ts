import {
  absenceVerdict,
  isCurrentlySearchable,
  resolveJobStatus,
} from './lifecycle';

const NOW = new Date('2026-08-23T00:00:00Z');
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60_000);
const WEEK = 7 * 24 * 60 * 60_000;

const status = (over: Partial<Parameters<typeof resolveJobStatus>[0]> = {}) =>
  resolveJobStatus({
    sources: [{ status: 'ACTIVE', lastSeenAt: NOW }],
    expiresAt: null,
    stalenessMs: 2 * WEEK,
    now: NOW,
    ...over,
  });

describe('a job is ACTIVE while any source still lists it', () => {
  it('a freshly observed job is ACTIVE', () => {
    expect(status()).toBe('ACTIVE');
  });

  it('one live source outweighs several dead ones', () => {
    // An aggregator dropping a posting proves nothing while the company's own
    // page still lists it.
    expect(
      status({
        sources: [
          { status: 'GONE', lastSeenAt: daysAgo(10) },
          { status: 'CLOSED', lastSeenAt: daysAgo(5) },
          { status: 'ACTIVE', lastSeenAt: NOW },
        ],
      }),
    ).toBe('ACTIVE');
  });
});

describe('closure requires positive evidence', () => {
  it('every source saying closed is CLOSED', () => {
    expect(
      status({
        sources: [
          { status: 'CLOSED', lastSeenAt: daysAgo(1) },
          { status: 'CLOSED', lastSeenAt: daysAgo(2) },
        ],
      }),
    ).toBe('CLOSED');
  });

  it('sources merely vanishing is UNAVAILABLE, not CLOSED', () => {
    // "We can no longer see it" is not "the employer ended it", and the two
    // deserve different words because only one is a fact about the job.
    expect(
      status({ sources: [{ status: 'GONE', lastSeenAt: daysAgo(3) }] }),
    ).toBe('UNAVAILABLE');
  });

  it('a stated deadline that has passed is EXPIRED', () => {
    expect(status({ expiresAt: daysAgo(1) })).toBe('EXPIRED');
  });

  it('a future deadline changes nothing', () => {
    expect(status({ expiresAt: new Date('2027-01-01T00:00:00Z') })).toBe(
      'ACTIVE',
    );
  });

  it('a job with no sources at all is UNAVAILABLE', () => {
    expect(status({ sources: [] })).toBe('UNAVAILABLE');
  });
});

describe('a provider outage must not empty the catalogue', () => {
  it('a FAILED run closes nothing', () => {
    // The rule that matters most here. A failed sweep saw an unknown fraction
    // of the catalogue; reading that as "these jobs are gone" would empty the
    // board during an outage and refill it afterwards.
    expect(
      absenceVerdict({ runSucceeded: false, absenceImpliesClosed: true }),
    ).toBeNull();
  });

  it('a successful run at a provider with unstable listings closes nothing', () => {
    expect(
      absenceVerdict({ runSucceeded: true, absenceImpliesClosed: false }),
    ).toBeNull();
  });

  it('only a successful run at a complete-listing provider implies GONE', () => {
    expect(
      absenceVerdict({ runSucceeded: true, absenceImpliesClosed: true }),
    ).toBe('GONE');
  });

  it('an unfetched job simply ages — it never jumps to CLOSED', () => {
    // The end state of an outage: jobs go STALE, which is visible, rather than
    // CLOSED, which is not.
    const outage = status({
      sources: [{ status: 'ACTIVE', lastSeenAt: daysAgo(30) }],
    });
    expect(outage).toBe('STALE');
    expect(outage).not.toBe('CLOSED');
  });
});

describe('STALE is shown on purpose', () => {
  it('a job unseen beyond its window is STALE', () => {
    expect(
      status({ sources: [{ status: 'ACTIVE', lastSeenAt: daysAgo(20) }] }),
    ).toBe('STALE');
  });

  it('and STALE is still searchable', () => {
    // Hiding it would choose a false negative — a real job nobody sees — over
    // a false positive the candidate can check in one click.
    expect(isCurrentlySearchable('STALE')).toBe(true);
    expect(isCurrentlySearchable('ACTIVE')).toBe(true);
  });

  it('while closed, expired and unavailable are not', () => {
    expect(isCurrentlySearchable('CLOSED')).toBe(false);
    expect(isCurrentlySearchable('EXPIRED')).toBe(false);
    expect(isCurrentlySearchable('UNAVAILABLE')).toBe(false);
  });

  it('a provider with a short window ages its jobs sooner', () => {
    const seen = daysAgo(10);
    expect(status({ sources: [{ status: 'ACTIVE', lastSeenAt: seen }] })).toBe(
      'ACTIVE',
    );
    expect(
      status({
        sources: [{ status: 'ACTIVE', lastSeenAt: seen }],
        stalenessMs: WEEK,
      }),
    ).toBe('STALE');
  });
});
