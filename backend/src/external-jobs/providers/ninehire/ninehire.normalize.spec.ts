import { ninehireIngestable, normalizeNinehireJob } from './ninehire.normalize';
import type { NinehireJob } from './ninehire.types';

/**
 * Normalization, against the officially documented response shape.
 *
 * These fixtures are built from the official field tables and samples, not
 * from live traffic: Ninehire's API is authenticated per workspace and no
 * authorized credential is configured here, so there is no honest way to
 * capture a real payload. Every field, enum value and quirk below is quoted
 * from the published documentation — including the two places where the docs
 * contradict themselves (`url` vs `applyUrl`, `employmentTypes` vs
 * `employmentType`), which the normalizer handles both ways.
 */

const SOURCE = { scope: 'acme', label: 'Acme Corp' };

/** The documented list sample, with the documented extra fields. */
const KOREAN_JOB: NinehireJob = {
  id: '2a2b0410-9b94-11ec-8ede-03ca65ff806e',
  title: 'React 웹 프론트엔드 개발자',
  deadline: '2027-02-28T00:00:00.905Z',
  applyUrl: 'https://career.ninehire.com/job_posting/3ETue9oP/apply',
  tags: ['프론트엔드'],
  career: 'irrelevant',
  employmentTypes: ['full_time'],
  careerRange: { over: 3, below: 6 },
  jobLocations: [
    {
      x: 129.124507082939,
      y: 35.175163705055,
      name: '부산지사',
      address: '부산 해운대구 센텀중앙로 97',
    },
  ],
  jobGroup: '개발팀',
  jobTask: '프론트엔드',
  affiliation: '나인하이어',
  createdAt: '2026-01-05T00:00:00.000Z',
  isPrivate: false,
  status: 'in_progress',
};

describe('ninehireIngestable', () => {
  describe('private postings', () => {
    it('never ingests a private posting', () => {
      expect(ninehireIngestable({ ...KOREAN_JOB, isPrivate: true })).toBe(
        false,
      );
    });

    it('ingests a public one', () => {
      expect(ninehireIngestable(KOREAN_JOB)).toBe(true);
    });
  });

  describe('status', () => {
    it('ingests in_progress — recruiting', () => {
      expect(ninehireIngestable({ ...KOREAN_JOB, status: 'in_progress' })).toBe(
        true,
      );
    });

    it('ingests closed — the only explicit closure evidence any provider gives', () => {
      expect(ninehireIngestable({ ...KOREAN_JOB, status: 'closed' })).toBe(
        true,
      );
    });

    it.each(['disabled', 'archived'])(
      'does NOT ingest %s — paused is not closed',
      (status) => {
        /*
         * Dropped rather than flagged. Neither is a closure: the employer has
         * stopped SHOWING the role, not ended it. Dropping means it vanishes
         * from the next complete snapshot and the generic absence rule retires
         * it as GONE → UNAVAILABLE, which is the honest distinction.
         */
        expect(ninehireIngestable({ ...KOREAN_JOB, status })).toBe(false);
      },
    );

    it('does not ingest an unknown or missing status', () => {
      for (const status of ['something_new', '', null, undefined, 7]) {
        expect(ninehireIngestable({ ...KOREAN_JOB, status })).toBe(false);
      }
    });

    it('excludes a private posting even when it is in_progress', () => {
      expect(
        ninehireIngestable({
          ...KOREAN_JOB,
          isPrivate: true,
          status: 'in_progress',
        }),
      ).toBe(false);
    });
  });
});

describe('normalizeNinehireJob', () => {
  describe('identity', () => {
    it('keys on the workspace-scoped posting id', () => {
      // The docs call the id unique per POSTING and say nothing about
      // uniqueness across workspaces, so it is not assumed.
      expect(normalizeNinehireJob(KOREAN_JOB, SOURCE)!.sourceJobId).toBe(
        'acme:2a2b0410-9b94-11ec-8ede-03ca65ff806e',
      );
    });

    it('declares the provider and the official API', () => {
      const job = normalizeNinehireJob(KOREAN_JOB, SOURCE)!;
      expect(job.provider).toBe('NINEHIRE');
      expect(job.accessMethod).toBe('OFFICIAL_API');
    });

    it('never keys on the title or the apply URL', () => {
      const renamed = normalizeNinehireJob(
        { ...KOREAN_JOB, title: '프론트엔드 개발자 (경력)' },
        SOURCE,
      )!;
      expect(renamed.sourceJobId).toBe(
        normalizeNinehireJob(KOREAN_JOB, SOURCE)!.sourceJobId,
      );
    });

    it.each([
      ['no title', { title: '  ' }],
      ['no apply URL', { applyUrl: null, url: null }],
      ['a javascript: URL', { applyUrl: 'javascript:alert(1)', url: null }],
      ['no id', { id: null }],
    ])('rejects a posting with %s', (_label, override) => {
      expect(
        normalizeNinehireJob({ ...KOREAN_JOB, ...override }, SOURCE),
      ).toBeNull();
    });

    it('reads the apply URL from either documented spelling', () => {
      // The list SAMPLE shows `url`; the list FIELD TABLE says `applyUrl`.
      const fromUrl = normalizeNinehireJob(
        {
          ...KOREAN_JOB,
          applyUrl: undefined,
          url: 'https://career.ninehire.com/job_posting/3ETue9oP/apply',
        },
        SOURCE,
      )!;
      expect(fromUrl.originalUrl).toBe(
        'https://career.ninehire.com/job_posting/3ETue9oP/apply',
      );
    });
  });

  describe('company identity', () => {
    it('prefers the configured source label', () => {
      // The operator configuring a workspace knows whose it is; `affiliation`
      // (소속) may name a division rather than the employer.
      expect(normalizeNinehireJob(KOREAN_JOB, SOURCE)!.companyName).toBe(
        'Acme Corp',
      );
    });

    it('falls back to affiliation when no label is configured', () => {
      const job = normalizeNinehireJob(KOREAN_JOB, {
        scope: 'acme',
        label: '',
      })!;
      expect(job.companyName).toBe('나인하이어');
    });

    it('never invents a company domain', () => {
      expect(
        normalizeNinehireJob(KOREAN_JOB, SOURCE)!.companyWebsiteUrl,
      ).toBeNull();
    });
  });

  describe('Korean text is preserved', () => {
    it.each([
      'React 웹 프론트엔드 개발자',
      '백엔드 개발자',
      '프론트엔드 개발자',
      '데이터 엔지니어',
      '마케팅 매니저',
      '간호사',
      '영업 관리자',
      '재무회계 담당자',
      '물류 운영 매니저',
      '인사 담당자',
    ])('stores %s verbatim', (title) => {
      const job = normalizeNinehireJob({ ...KOREAN_JOB, title }, SOURCE)!;
      expect(job.title).toBe(title);
      // Not romanized, not translated, not stripped.
      expect(job.title).not.toMatch(/^[\x20-\x7E]*$/);
    });

    it('handles an English title on the same workspace', () => {
      const job = normalizeNinehireJob(
        { ...KOREAN_JOB, title: 'Senior Backend Engineer' },
        SOURCE,
      )!;
      expect(job.title).toBe('Senior Backend Engineer');
    });

    it('keeps a Korean description as Korean plain text', () => {
      const job = normalizeNinehireJob(
        {
          ...KOREAN_JOB,
          content:
            '<p><strong>프론트엔드 개발자 채용</strong></p>' +
            '<p>React 기반의 웹 서비스를 함께 만들어 갈 동료를 찾습니다.</p>',
        },
        SOURCE,
      )!;
      expect(job.description).toContain('프론트엔드 개발자 채용');
      expect(job.description).toContain('React 기반의 웹 서비스');
      expect(job.description).not.toContain('<p>');
    });
  });

  describe('employment type', () => {
    it.each([
      ['full_time', 'FULL_TIME'],
      ['contractor', 'CONTRACT'],
      ['intern', 'INTERNSHIP'],
      ['part_time', 'PART_TIME'],
    ])('maps the single documented value %s', (value, expected) => {
      const job = normalizeNinehireJob(
        { ...KOREAN_JOB, employmentTypes: [value] },
        SOURCE,
      )!;
      expect(job.employmentType).toBe(expected);
    });

    it.each(['freelancer', 'dispatched', 'day_labor', 'trainee'])(
      'refuses to force the Korean-market value %s into the enum',
      (value) => {
        /*
         * 파견직 (dispatched), 일용직 (day_labor) and 교육생 (trainee) are
         * distinct legal arrangements. Rounding 파견직 to CONTRACT would tell a
         * candidate they are being hired by the company they would actually be
         * dispatched TO.
         */
        const job = normalizeNinehireJob(
          { ...KOREAN_JOB, employmentTypes: [value] },
          SOURCE,
        )!;
        expect(job.employmentType).toBeNull();
      },
    );

    it('refuses a multi-valued employment type', () => {
      // Two answers is no answer, and the schema holds one.
      const job = normalizeNinehireJob(
        { ...KOREAN_JOB, employmentTypes: ['full_time', 'contractor'] },
        SOURCE,
      )!;
      expect(job.employmentType).toBeNull();
    });

    it('does not pick the first of several', () => {
      const job = normalizeNinehireJob(
        { ...KOREAN_JOB, employmentTypes: ['full_time', 'part_time'] },
        SOURCE,
      )!;
      expect(job.employmentType).not.toBe('FULL_TIME');
      expect(job.employmentType).toBeNull();
    });

    it('reads the singular detail spelling too', () => {
      // The list uses `employmentTypes`; the documented detail sample uses
      // `employmentType`.
      const job = normalizeNinehireJob(
        {
          ...KOREAN_JOB,
          employmentTypes: undefined,
          employmentType: ['intern'],
        },
        SOURCE,
      )!;
      expect(job.employmentType).toBe('INTERNSHIP');
    });

    it('is null when none is stated', () => {
      const job = normalizeNinehireJob(
        { ...KOREAN_JOB, employmentTypes: [] },
        SOURCE,
      )!;
      expect(job.employmentType).toBeNull();
    });
  });

  describe('career and seniority', () => {
    it.each(['irrelevant', 'experienced', 'newcomer'])(
      'never derives a seniority level from career=%s',
      (career) => {
        /*
         * "experienced" means prior experience is REQUIRED, not that the role
         * is senior; 신입 (newcomer) is a hiring track, not a rung. Mapping
         * either would re-rank the catalogue on a mistranslation.
         */
        const job = normalizeNinehireJob({ ...KOREAN_JOB, career }, SOURCE)!;
        expect(job.seniorityLevel).toBeNull();
      },
    );

    it('never derives seniority from a year range', () => {
      const job = normalizeNinehireJob(
        {
          ...KOREAN_JOB,
          career: 'experienced',
          careerRange: { over: 8, below: 15 },
        },
        SOURCE,
      )!;
      expect(job.seniorityLevel).toBeNull();
    });
  });

  describe('locations', () => {
    it('resolves a Korean address to country, region and city', () => {
      const job = normalizeNinehireJob(KOREAN_JOB, SOURCE)!;
      expect(job.countryCode).toBe('KR');
      expect(job.region).toBe('부산');
      expect(job.city).toBe('해운대구');
    });

    it('never stores the site LABEL as a city', () => {
      // "부산지사" is "Busan branch" — a site name, not a place.
      const job = normalizeNinehireJob(KOREAN_JOB, SOURCE)!;
      expect(job.city).not.toBe('부산지사');
    });

    it('keeps every work site, not just the first', () => {
      const job = normalizeNinehireJob(
        {
          ...KOREAN_JOB,
          jobLocations: [
            { name: '본사', address: '서울 강남구 테헤란로 123' },
            { name: '부산지사', address: '부산 해운대구 센텀중앙로 97' },
            { name: '제주오피스', address: '제주특별자치도 제주시 문연로 6' },
          ],
        },
        SOURCE,
      )!;
      expect(job).toMatchObject({
        countryCode: 'KR',
        region: '서울',
        city: '강남구',
      });
      expect(job.additionalLocations).toEqual([
        { countryCode: 'KR', region: '부산', city: '해운대구' },
        { countryCode: 'KR', region: '제주', city: '제주시' },
      ]);
    });

    it('deduplicates repeated sites', () => {
      const job = normalizeNinehireJob(
        {
          ...KOREAN_JOB,
          jobLocations: [
            { name: '본사', address: '서울 강남구 테헤란로 123' },
            { name: '별관', address: '서울 강남구 테헤란로 456' },
          ],
        },
        SOURCE,
      )!;
      // Same region and city; one place, written twice.
      expect(job.additionalLocations).toEqual([]);
    });

    it('yields no place for an unparseable address', () => {
      const job = normalizeNinehireJob(
        { ...KOREAN_JOB, jobLocations: [{ name: '본사', address: '어딘가' }] },
        SOURCE,
      )!;
      expect(job.countryCode).toBeNull();
      expect(job.city).toBeNull();
    });

    it('yields no place when no locations are stated', () => {
      const job = normalizeNinehireJob(
        { ...KOREAN_JOB, jobLocations: [] },
        SOURCE,
      )!;
      expect(job.countryCode).toBeNull();
      expect(job.additionalLocations).toEqual([]);
    });

    it('does not store coordinates anywhere', () => {
      // x/y are read and deliberately not persisted: no column, no consumer.
      const serialized = JSON.stringify(
        normalizeNinehireJob(KOREAN_JOB, SOURCE),
      );
      expect(serialized).not.toContain('129.12');
      expect(serialized).not.toContain('35.17');
    });

    it('never infers a work mode', () => {
      const job = normalizeNinehireJob(KOREAN_JOB, SOURCE)!;
      expect(job.workMode).toBeNull();
      expect(job.remoteCountriesAllowed).toEqual([]);
    });
  });

  describe('deadline', () => {
    it('maps a stated deadline to expiresAt', () => {
      const job = normalizeNinehireJob(KOREAN_JOB, SOURCE)!;
      expect(job.expiresAt?.toISOString()).toBe('2027-02-28T00:00:00.905Z');
    });

    it('is null for 상시 채용 — rolling hiring', () => {
      // A stated fact, not missing data.
      const job = normalizeNinehireJob(
        { ...KOREAN_JOB, deadline: null },
        SOURCE,
      )!;
      expect(job.expiresAt).toBeNull();
    });

    it('refuses an implausible deadline', () => {
      const job = normalizeNinehireJob(
        { ...KOREAN_JOB, deadline: '2147-01-01T00:00:00Z' },
        SOURCE,
      )!;
      expect(job.expiresAt).toBeNull();
    });

    it('keeps a deadline that has already passed', () => {
      // Storing it is what lets the lifecycle mark the job EXPIRED.
      const job = normalizeNinehireJob(
        { ...KOREAN_JOB, deadline: '2023-02-28T00:00:00.905Z' },
        SOURCE,
      )!;
      expect(job.expiresAt?.getFullYear()).toBe(2023);
    });
  });

  describe('closure', () => {
    it('marks a closed posting as closed at source', () => {
      // 채용 마감됨 — the employer's own statement, and the first real closure
      // evidence any provider in this product has given.
      const job = normalizeNinehireJob(
        { ...KOREAN_JOB, status: 'closed' },
        SOURCE,
      )!;
      expect(job.closedAtSource).toBe(true);
    });

    it('does not mark a recruiting posting as closed', () => {
      expect(normalizeNinehireJob(KOREAN_JOB, SOURCE)!.closedAtSource).toBe(
        false,
      );
    });
  });

  describe('salary', () => {
    it('states no salary, because the API exposes none', () => {
      /*
       * Verified against the official field tables for BOTH endpoints: there
       * is no compensation field of any kind. The Task 4A fixture that
       * suggested otherwise was a structural stand-in, not the real contract.
       */
      const job = normalizeNinehireJob(KOREAN_JOB, SOURCE)!;
      expect(job.salaryMin).toBeNull();
      expect(job.salaryMax).toBeNull();
      expect(job.currency).toBeNull();
      expect(job.payPeriod).toBeNull();
    });

    it('invents nothing from tags or the description', () => {
      const job = normalizeNinehireJob(
        {
          ...KOREAN_JOB,
          tags: ['연봉 4000만원', '프론트엔드'],
          content: '<p>연봉 4,000만원 ~ 6,000만원</p>',
        },
        SOURCE,
      )!;
      expect(job.salaryMin).toBeNull();
      expect(job.currency).toBeNull();
    });
  });

  describe('unmapped source metadata', () => {
    it('does not turn jobGroup into an industry', () => {
      // 개발팀 is a development TEAM, not a sector.
      const job = normalizeNinehireJob(KOREAN_JOB, SOURCE)!;
      expect(job.industries).toEqual([]);
    });

    it('does not turn tags into skills', () => {
      const job = normalizeNinehireJob(
        { ...KOREAN_JOB, tags: ['프론트엔드', '재택근무 가능', '2026 상반기'] },
        SOURCE,
      )!;
      expect(job.skills).toEqual([]);
      expect(job.benefits).toEqual([]);
    });

    it('leaves work authorization unstated', () => {
      const job = normalizeNinehireJob(KOREAN_JOB, SOURCE)!;
      expect(job.visaSponsorship).toBe('UNKNOWN');
      expect(job.existingWorkAuthorizationRequired).toBeNull();
      expect(job.eligibleVisaTypes).toEqual([]);
    });
  });

  describe('description safety', () => {
    it('is null when only the list was read', () => {
      // `content` lives on the detail endpoint alone.
      const job = normalizeNinehireJob(KOREAN_JOB, SOURCE)!;
      expect(job.description).toBeNull();
    });

    it('removes a script from the detail content', () => {
      const job = normalizeNinehireJob(
        {
          ...KOREAN_JOB,
          content:
            '<p>React 기반의 웹 서비스를 함께 만들어 갈 동료를 찾습니다.</p>' +
            '<script>alert(1)</script>',
        },
        SOURCE,
      )!;
      expect(job.description).toContain('동료를 찾습니다');
      expect(job.description).not.toContain('alert(1)');
      expect(job.description).not.toContain('script');
    });

    it('removes entity-encoded markup', () => {
      const job = normalizeNinehireJob(
        {
          ...KOREAN_JOB,
          content:
            '&lt;p&gt;React 기반의 웹 서비스를 함께 만들어 갈 동료를 ' +
            '찾습니다.&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
        },
        SOURCE,
      )!;
      expect(job.description).toContain('동료를 찾습니다');
      expect(job.description).not.toContain('alert(1)');
      expect(job.description).not.toContain('&lt;');
    });

    it('strips inline event handlers', () => {
      const job = normalizeNinehireJob(
        {
          ...KOREAN_JOB,
          content:
            '<img src=x onerror="alert(1)"><div onclick="steal()">React 기반의 ' +
            '웹 서비스를 함께 만들어 갈 동료를 찾습니다.</div>',
        },
        SOURCE,
      )!;
      expect(job.description).not.toContain('onerror');
      expect(job.description).not.toContain('onclick');
      expect(job.description).not.toContain('alert(1)');
    });

    it('strips a javascript: URL', () => {
      const job = normalizeNinehireJob(
        {
          ...KOREAN_JOB,
          content:
            '<a href="javascript:alert(1)">지금 바로 지원하세요. React 개발자를 ' +
            '찾고 있습니다.</a>',
        },
        SOURCE,
      )!;
      expect(job.description).not.toContain('javascript:');
      expect(job.description).not.toContain('alert(1)');
    });

    it('stores no raw HTML field', () => {
      const job = normalizeNinehireJob(
        { ...KOREAN_JOB, content: '<p>내용</p>' },
        SOURCE,
      )!;
      expect(Object.keys(job)).not.toContain('content');
      expect(Object.keys(job)).not.toContain('descriptionHtml');
    });
  });

  describe('general professions', () => {
    const professions = [
      '백엔드 개발자',
      '영업 관리자',
      '마케팅 매니저',
      '재무회계 담당자',
      '물류 운영 매니저',
      '간호사',
      '그래픽 디자이너',
      '고객지원 담당자',
      'Senior Backend Engineer',
    ];

    it.each(professions)('normalizes %s', (title) => {
      const job = normalizeNinehireJob({ ...KOREAN_JOB, title }, SOURCE);
      expect(job).not.toBeNull();
      expect(job!.title).toBe(title);
      expect(job!.countryCode).toBe('KR');
    });

    it('applies no profession filter of any kind', () => {
      const results = professions.map((title) =>
        normalizeNinehireJob({ ...KOREAN_JOB, title }, SOURCE),
      );
      expect(results.filter(Boolean)).toHaveLength(professions.length);
    });
  });

  describe('provider vocabulary does not escape', () => {
    it('produces only contract fields', () => {
      const serialized = JSON.stringify(
        normalizeNinehireJob(KOREAN_JOB, SOURCE),
      ).toLowerCase();
      for (const token of [
        'joblocations',
        'jobgroup',
        'jobtask',
        'affiliation',
        'careerrange',
        'employmenttypes',
        'isprivate',
        'in_progress',
        'ninehire',
      ]) {
        // The apply URL is genuinely a career.ninehire.com link and must
        // survive; the FIELD vocabulary must not.
        if (token === 'ninehire') continue;
        expect(serialized).not.toContain(token);
      }
    });
  });
});

/**
 * Ninehire's `createdAt` is posting creation, not publication — the same
 * distinction that rules out Lever's field of the same name. The documented
 * payload has no publication timestamp, so the claim stays null.
 */
describe('normalizeNinehireJob publication date', () => {
  it('never maps createdAt to the publication date', () => {
    const job = normalizeNinehireJob(
      { ...KOREAN_JOB, createdAt: '2026-01-05T00:00:00.000Z' },
      SOURCE,
    )!;
    expect(job.employerPosted).toBeNull();
  });

  it('never maps the deadline to the publication date', () => {
    // `deadline` is the far end of the posting's life. It is already mapped to
    // expiresAt and says nothing about when the employer published.
    const job = normalizeNinehireJob(
      { ...KOREAN_JOB, deadline: '2026-12-31T00:00:00.000Z' },
      SOURCE,
    )!;
    expect(job.employerPosted).toBeNull();
    expect(job.expiresAt).not.toBeNull();
  });
});
