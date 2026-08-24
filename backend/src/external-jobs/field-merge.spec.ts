import type { PostingDateSemantics } from './external-job.contract';
import {
  resolveEmployerPosted,
  chooseCanonicalUrl,
  resolveField,
  resolveSalary,
} from './field-merge';

const EARLIER = new Date('2026-08-01T00:00:00Z');
const LATER = new Date('2026-08-20T00:00:00Z');

describe('a stated fact always beats silence', () => {
  it('a low-trust source that published a salary beats a high-trust one that did not', () => {
    // The rule that comes first, and the one most easily got wrong: a trusted
    // source omitting a field has NOT contradicted anyone. Treating its
    // silence as an answer would erase real information.
    const winner = resolveField([
      { value: null, provider: 'COMPANY_CAREERS', observedAt: LATER },
      { value: 45_000, provider: 'SARAMIN', observedAt: EARLIER },
    ]);

    expect(winner.value).toBe(45_000);
    expect(winner.provider).toBe('SARAMIN');
  });

  it('everyone silent stays null — which is a real answer', () => {
    expect(
      resolveField([
        { value: null, provider: 'GREENHOUSE', observedAt: LATER },
        { value: null, provider: 'WANTED', observedAt: EARLIER },
      ]),
    ).toEqual({ value: null, provider: null });
  });

  it('an empty list counts as silence, not as a stated emptiness', () => {
    const winner = resolveField<string[]>([
      { value: [], provider: 'COMPANY_CAREERS', observedAt: LATER },
      { value: ['react'], provider: 'WANTED', observedAt: EARLIER },
    ]);
    expect(winner.value).toEqual(['react']);
  });
});

describe('between two stated facts, closeness to the employer wins', () => {
  it("the company's own page beats an aggregator", () => {
    const winner = resolveField([
      { value: 40_000, provider: 'WANTED', observedAt: LATER },
      { value: 50_000, provider: 'COMPANY_CAREERS', observedAt: EARLIER },
    ]);
    expect(winner.value).toBe(50_000);
  });

  it('between equals, the freshest reading wins', () => {
    // Postings get edited; the later reading is the current one.
    const winner = resolveField([
      { value: 40_000, provider: 'GREENHOUSE', observedAt: EARLIER },
      { value: 44_000, provider: 'LEVER', observedAt: LATER },
    ]);
    expect(winner.value).toBe(44_000);
  });

  it('an unknown provider is trusted least, not most', () => {
    const winner = resolveField([
      { value: 1, provider: 'SOMETHING_NEW', observedAt: LATER },
      { value: 2, provider: 'NINEHIRE', observedAt: EARLIER },
    ]);
    expect(winner.value).toBe(2);
  });
});

describe('salary is resolved as one statement, never field by field', () => {
  it('takes the whole claim from a single source', () => {
    /*
     * The failure this prevents: taking the amount from the source with the
     * highest floor and the currency from whichever is more trusted produces
     * "40,000,000 USD" — a number no employer ever wrote.
     */
    const winner = resolveSalary([
      {
        salaryMin: 40_000_000,
        salaryMax: 55_000_000,
        currency: 'KRW',
        payPeriod: 'YEARLY',
        provider: 'NINEHIRE',
        observedAt: LATER,
      },
      {
        salaryMin: 35_000,
        salaryMax: 45_000,
        currency: 'USD',
        payPeriod: 'YEARLY',
        provider: 'WANTED',
        observedAt: LATER,
      },
    ])!;

    expect(winner.currency).toBe('KRW');
    expect(winner.salaryMin).toBe(40_000_000);
    expect(winner.salaryMax).toBe(55_000_000);
  });

  it('ignores an incomplete claim — an amount with no currency is a number', () => {
    const winner = resolveSalary([
      {
        salaryMin: 90_000,
        salaryMax: null,
        currency: null,
        payPeriod: null,
        provider: 'COMPANY_CAREERS',
        observedAt: LATER,
      },
      {
        salaryMin: 70_000,
        salaryMax: null,
        currency: 'USD',
        payPeriod: 'YEARLY',
        provider: 'WANTED',
        observedAt: EARLIER,
      },
    ])!;

    expect(winner.currency).toBe('USD');
    expect(winner.salaryMin).toBe(70_000);
  });

  it('returns null when nobody stated a usable salary', () => {
    expect(
      resolveSalary([
        {
          salaryMin: null,
          salaryMax: null,
          currency: null,
          payPeriod: null,
          provider: 'GREENHOUSE',
          observedAt: LATER,
        },
      ]),
    ).toBeNull();
  });
});

describe('the canonical URL is where the candidate should actually apply', () => {
  it('prefers the employer over an aggregator', () => {
    // The one place source trust genuinely costs a person something: sending
    // them to a mirror when the employer's own form exists loses them the
    // application.
    const chosen = chooseCanonicalUrl([
      {
        provider: 'WANTED',
        sourceUrl: 'https://wanted.example/jobs/9',
        originalUrl: null,
        observedAt: LATER,
      },
      {
        provider: 'COMPANY_CAREERS',
        sourceUrl: 'https://abc.com/careers/backend',
        originalUrl: null,
        observedAt: EARLIER,
      },
    ])!;

    expect(chosen.url).toBe('https://abc.com/careers/backend');
  });

  it('prefers the apply link over the listing link within one source', () => {
    const chosen = chooseCanonicalUrl([
      {
        provider: 'LEVER',
        sourceUrl: 'https://jobs.lever.co/abc/1',
        originalUrl: 'https://jobs.lever.co/abc/1/apply',
        observedAt: LATER,
      },
    ])!;

    expect(chosen.url).toContain('/apply');
  });

  it('has nothing to choose when there are no sources', () => {
    expect(chooseCanonicalUrl([])).toBeNull();
  });
});

/**
 * The employer's publication date, across sources that may disagree.
 *
 * The rules are the project's existing ones — stated beats silence, then
 * trust, then freshness — and the tests below exist to prove that this field
 * did not quietly acquire different ones. The cases that matter are the two a
 * date invites and nothing else does: taking the earliest, or taking the
 * latest, of two disagreeing sources. Both invent a moment nobody published.
 */
describe('the employer publication date', () => {
  const posted = (
    at: string,
    semantics: PostingDateSemantics = 'LAST_PUBLISHED',
  ) => ({ at, semantics });

  it('takes the only stated date', () => {
    const winner = resolveEmployerPosted([
      {
        posted: posted('2026-08-20T09:00:00Z'),
        provider: 'ASHBY',
        observedAt: LATER,
      },
    ]);
    expect(winner.posted?.at).toBe('2026-08-20T09:00:00Z');
    expect(winner.provider).toBe('ASHBY');
  });

  it('is null when every source is silent', () => {
    // Silence is a real answer and stays one: null, never a substituted date.
    expect(
      resolveEmployerPosted([
        { posted: null, provider: 'LEVER', observedAt: LATER },
        { posted: null, provider: 'GREENHOUSE', observedAt: EARLIER },
      ]).posted,
    ).toBeNull();
  });

  it('keeps a stated date when another source says nothing', () => {
    // The case §55 names: a silent source must not erase a stated fact, even
    // when it is the more trusted one. It did not contradict anything.
    const winner = resolveEmployerPosted([
      {
        posted: posted('2026-08-20T09:00:00Z'),
        provider: 'ASHBY',
        observedAt: EARLIER,
      },
      { posted: null, provider: 'COMPANY_CAREERS', observedAt: LATER },
    ]);
    expect(winner.posted?.at).toBe('2026-08-20T09:00:00Z');
    expect(winner.provider).toBe('ASHBY');
  });

  it('agrees with itself when two sources agree', () => {
    const winner = resolveEmployerPosted([
      {
        posted: posted('2026-08-20T00:00:00Z', 'DATE_POSTED'),
        provider: 'COMPANY_CAREERS',
        observedAt: EARLIER,
      },
      {
        posted: posted('2026-08-20T00:00:00Z'),
        provider: 'ASHBY',
        observedAt: LATER,
      },
    ]);
    expect(winner.posted?.at).toBe('2026-08-20T00:00:00Z');
  });

  it('lets the source closest to the employer win a disagreement', () => {
    const winner = resolveEmployerPosted([
      {
        posted: posted('2026-08-19T00:00:00Z'),
        provider: 'ASHBY',
        observedAt: LATER,
      },
      {
        posted: posted('2026-08-21T00:00:00Z', 'DATE_POSTED'),
        provider: 'COMPANY_CAREERS',
        observedAt: EARLIER,
      },
    ]);
    // A company republishing on its own site is the employer speaking about
    // its own listing more directly than the ATS behind it.
    expect(winner.provider).toBe('COMPANY_CAREERS');
    expect(winner.posted?.at).toBe('2026-08-21T00:00:00Z');
  });

  it('breaks a same-trust disagreement on the fresher observation', () => {
    const winner = resolveEmployerPosted([
      {
        posted: posted('2026-08-19T00:00:00Z'),
        provider: 'ASHBY',
        observedAt: EARLIER,
      },
      {
        posted: posted('2026-08-21T00:00:00Z', 'FIRST_PUBLISHED'),
        provider: 'GREENHOUSE',
        observedAt: LATER,
      },
    ]);
    expect(winner.provider).toBe('GREENHOUSE');
  });

  it('never takes the earliest, the latest or an average of the two', () => {
    const claims = [
      {
        posted: posted('2026-01-01T00:00:00Z'),
        provider: 'ASHBY',
        observedAt: LATER,
      },
      {
        posted: posted('2026-12-01T00:00:00Z', 'DATE_POSTED'),
        provider: 'COMPANY_CAREERS',
        observedAt: EARLIER,
      },
    ];
    const winner = resolveEmployerPosted(claims);
    // Exactly one source's own statement, unmodified. min/max/mean would each
    // be a date no employer ever published.
    expect(claims.map((c) => c.posted.at)).toContain(winner.posted?.at);
  });

  it('carries the semantics of the winning claim, not a blend', () => {
    const winner = resolveEmployerPosted([
      {
        posted: posted('2026-08-19T00:00:00Z', 'FIRST_PUBLISHED'),
        provider: 'GREENHOUSE',
        observedAt: EARLIER,
      },
      {
        posted: posted('2026-08-21T00:00:00Z', 'DATE_POSTED'),
        provider: 'COMPANY_CAREERS',
        observedAt: LATER,
      },
    ]);
    // The timestamp and what kind of publication event it names travel
    // together, so an audit can always say which fact was chosen.
    expect(winner.posted).toEqual({
      at: '2026-08-21T00:00:00Z',
      semantics: 'DATE_POSTED',
    });
  });

  it('ignores a claim with no timestamp', () => {
    expect(
      resolveEmployerPosted([
        {
          posted: { at: '', semantics: 'LAST_PUBLISHED' },
          provider: 'ASHBY',
          observedAt: LATER,
        },
      ]).posted,
    ).toBeNull();
  });
});
