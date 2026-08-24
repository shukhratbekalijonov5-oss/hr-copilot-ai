import {
  normalizeEmploymentType,
  normalizeEnumList,
  normalizePreferenceEntries,
} from './job-vocabulary';

/**
 * The bridge between a vacancy's original free-text employment string and the
 * normalized value candidate preferences store.
 *
 * It exists so there is ONE vocabulary with one explicit translation point,
 * rather than a second enum that silently disagrees with 206 existing rows.
 */
describe('normalizeEmploymentType', () => {
  it('maps the values vacancies actually hold today', () => {
    expect(normalizeEmploymentType('Full-time')).toBe('FULL_TIME');
    expect(normalizeEmploymentType('Part-time')).toBe('PART_TIME');
    expect(normalizeEmploymentType('Contract')).toBe('CONTRACT');
    expect(normalizeEmploymentType('Internship')).toBe('INTERNSHIP');
    expect(normalizeEmploymentType('Temporary')).toBe('TEMPORARY');
  });

  it('ignores case and separators', () => {
    for (const spelling of [
      'FULL_TIME',
      'full time',
      'FullTime',
      'full-TIME',
    ]) {
      expect(normalizeEmploymentType(spelling)).toBe('FULL_TIME');
    }
  });

  it('returns null for anything it does not recognize', () => {
    // Null must stay "this job did not say, in a form we understand" — never a
    // default like FULL_TIME, which would include or exclude jobs on a value
    // nobody wrote.
    expect(normalizeEmploymentType('Seasonal weekend gig')).toBeNull();
    expect(normalizeEmploymentType('')).toBeNull();
    expect(normalizeEmploymentType(null)).toBeNull();
    expect(normalizeEmploymentType(undefined)).toBeNull();
  });
});

describe('normalizePreferenceEntries', () => {
  it('keeps the candidate’s own spelling of a duplicate', () => {
    expect(
      normalizePreferenceEntries(['DevOps Engineer', 'devops engineer']),
    ).toEqual(['DevOps Engineer']);
  });

  it('trims, collapses inner whitespace and drops blanks', () => {
    expect(
      normalizePreferenceEntries(['  Site   Reliability  ', '', '   ']),
    ).toEqual(['Site Reliability']);
  });

  it('preserves the order the candidate gave', () => {
    expect(normalizePreferenceEntries(['B', 'A', 'B'])).toEqual(['B', 'A']);
  });
});

describe('normalizeEnumList', () => {
  it('de-duplicates without reordering', () => {
    expect(normalizeEnumList(['REMOTE', 'HYBRID', 'REMOTE'])).toEqual([
      'REMOTE',
      'HYBRID',
    ]);
  });
});
