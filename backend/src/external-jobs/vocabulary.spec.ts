import { employmentTypeFrom, payPeriodFrom, workModeFrom } from './vocabulary';

/**
 * The shared provider vocabulary.
 *
 * These dictionaries decide whether a provider's word becomes a fact in this
 * product. The tests are mostly about REFUSALS, because that is where the harm
 * lives: an unmapped value costs a ranking signal, a wrongly-mapped one is
 * trusted, invisible and acts like something the employer said.
 */

describe('employmentTypeFrom', () => {
  it.each([
    ['Full-time', 'FULL_TIME'],
    ['Full Time', 'FULL_TIME'],
    ['full time', 'FULL_TIME'],
    ['FULLTIME', 'FULL_TIME'],
    ['full_time', 'FULL_TIME'],
    ['Part-time', 'PART_TIME'],
    ['Part Time', 'PART_TIME'],
    ['Contract', 'CONTRACT'],
    ['Contractor', 'CONTRACT'],
    ['Internship', 'INTERNSHIP'],
    ['Intern', 'INTERNSHIP'],
    ['Temporary', 'TEMPORARY'],
    ['Temp', 'TEMPORARY'],
  ])('maps %s', (value, expected) => {
    expect(employmentTypeFrom(value)).toBe(expected);
  });

  describe('values live ATS data actually contains, and why each is null', () => {
    it('refuses a value naming two types at once', () => {
      // Mapping this to FULL_TIME hides the job from everyone filtering for
      // part-time work.
      expect(employmentTypeFrom('Full Time/Part Time')).toBeNull();
    });

    it('refuses a compound the schema cannot hold', () => {
      // Temporary AND full-time; one column, two facts.
      expect(employmentTypeFrom('Temp Full-time')).toBeNull();
    });

    it('refuses a contract DURATION dressed as a type', () => {
      expect(employmentTypeFrom('Fixed Term')).toBeNull();
      expect(employmentTypeFrom('Permanent')).toBeNull();
    });

    it('refuses apprenticeship rather than calling it an internship', () => {
      // Different legal status, different pay, different protections.
      expect(employmentTypeFrom('Apprenticeship')).toBeNull();
    });

    it('refuses freelance rather than calling it a contract', () => {
      expect(employmentTypeFrom('Freelance')).toBeNull();
    });
  });

  it('never matches on a substring', () => {
    // The bug an includes() implementation has.
    expect(employmentTypeFrom('Contract-to-hire pipeline')).toBeNull();
    expect(employmentTypeFrom('Not full time at all')).toBeNull();
  });

  it('is null for junk and non-strings', () => {
    for (const value of ['', '   ', null, undefined, 42, {}, []]) {
      expect(employmentTypeFrom(value)).toBeNull();
    }
  });
});

describe('workModeFrom', () => {
  it.each([
    ['remote', 'REMOTE'],
    ['Remote', 'REMOTE'],
    ['hybrid', 'HYBRID'],
    // The documented spelling and the one live data uses.
    ['on-site', 'ONSITE'],
    ['onsite', 'ONSITE'],
    ['On Site', 'ONSITE'],
    ['in-office', 'ONSITE'],
  ])('maps the stated %s', (value, expected) => {
    expect(workModeFrom(value)).toBe(expected);
  });

  it('treats "unspecified" as unstated', () => {
    // A real Lever value meaning exactly what it says.
    expect(workModeFrom('unspecified')).toBeNull();
  });

  it('refuses prose', () => {
    // This function must never be fed a location label; if it is, it still
    // refuses rather than guessing.
    for (const value of [
      'Hybrid - London',
      'New York, NY or Remote',
      'Remote-friendly',
      'Mostly remote',
      'Flexible',
    ]) {
      expect(workModeFrom(value)).toBeNull();
    }
  });

  it('is null for junk and non-strings', () => {
    for (const value of ['', null, undefined, true, 3]) {
      expect(workModeFrom(value)).toBeNull();
    }
  });
});

describe('payPeriodFrom', () => {
  it.each([
    ['per-year-salary', 'YEARLY'],
    ['yearly', 'YEARLY'],
    ['annual', 'YEARLY'],
    ['per-month-salary', 'MONTHLY'],
    ['monthly', 'MONTHLY'],
    ['per-hour-wage', 'HOURLY'],
    ['hourly', 'HOURLY'],
    // schema.org writes the bare unit in QuantitativeValue.unitText.
    ['YEAR', 'YEARLY'],
    ['MONTH', 'MONTHLY'],
    ['HOUR', 'HOURLY'],
  ])('maps %s', (value, expected) => {
    expect(payPeriodFrom(value)).toBe(expected);
  });

  it('refuses schema.org units the enum cannot express', () => {
    // DAY and WEEK are legal unitText values with no home in a three-member
    // enum, and multiplying a weekly figure by 52 would publish a number no
    // employer wrote.
    expect(payPeriodFrom('DAY')).toBeNull();
    expect(payPeriodFrom('WEEK')).toBeNull();
  });

  it('refuses a period the enum cannot express', () => {
    /*
     * "bi-week-salary" is live Lever data. Annualising it by 26 would turn a
     * stated fact into a derived one and store it as the employer's word. The
     * amount survives, the period does not, and the matcher reports the job
     * as not comparable on salary — visible and true.
     */
    expect(payPeriodFrom('bi-week-salary')).toBeNull();
    expect(payPeriodFrom('per-week-salary')).toBeNull();
    expect(payPeriodFrom('one-time')).toBeNull();
    expect(payPeriodFrom('per-quarter-salary')).toBeNull();
  });

  it('is null for junk and non-strings', () => {
    for (const value of ['', 'salary', null, undefined, 1]) {
      expect(payPeriodFrom(value)).toBeNull();
    }
  });
});

describe('the mappings are provider-neutral', () => {
  it('has no provider-specific entry point', () => {
    // "Full-time means FULL_TIME" is not a fact about Lever. Providers add
    // ENTRIES here; they do not get their own mapper.
    const module = jest.requireActual<Record<string, unknown>>('./vocabulary');
    for (const name of Object.keys(module)) {
      expect(name.toLowerCase()).not.toMatch(
        /lever|greenhouse|ashby|ninehire|saramin|jobkorea|wanted/,
      );
    }
  });

  it('gives the same answer regardless of who is asking', () => {
    expect(employmentTypeFrom('Full-time')).toBe(
      employmentTypeFrom('Full Time'),
    );
    expect(workModeFrom('onsite')).toBe(workModeFrom('on-site'));
  });
});
