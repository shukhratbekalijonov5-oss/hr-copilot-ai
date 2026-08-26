import {
  claimedYears,
  datedCareerSpan,
  detectContradictions,
} from './contradictions';
import { buildProfileFacts } from './profile-facts';

const facts = (over: Record<string, unknown>) =>
  buildProfileFacts({
    headline: null,
    summary: null,
    location: null,
    skills: [],
    languages: [],
    experience: [],
    education: [],
    ...over,
  });

describe('contradiction detection', () => {
  it('claimed years far above the dated span is flagged — in neutral language', () => {
    const profile = facts({
      summary: 'Backend developer with 8 years of Java experience',
      experience: [{ title: 'Developer', startDate: '2024', endDate: '2025' }],
    });
    const found = detectContradictions(profile);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('EXPERIENCE_YEARS_CLAIM');
    expect(found[0].summary).toContain('Conflicting evidence detected');
    expect(found[0].summary).not.toMatch(/lie|lying|dishonest|false claim/i);
    expect(found[0].confidencePenalty).toBe(5);
  });

  it('claims within the 2-year margin are NOT contradictions', () => {
    const profile = facts({
      summary: '5 years of experience',
      experience: [
        { title: 'Developer', startDate: '2022', endDate: 'present' },
      ],
    });
    // span 2022→2026 = 4; claimed 5 ≤ 4+2 → silence.
    expect(detectContradictions(profile)).toEqual([]);
  });

  it('no parseable dates → no contradiction is ever invented', () => {
    const profile = facts({
      summary: '10 years of experience',
      experience: [{ title: 'Developer', startDate: 'a while ago' }],
    });
    expect(detectContradictions(profile)).toEqual([]);
  });

  it('an entry ending before it starts is a DATE_ORDER conflict', () => {
    const profile = facts({
      experience: [{ title: 'Engineer', startDate: '2023', endDate: '2021' }],
    });
    const found = detectContradictions(profile);
    expect(found[0].kind).toBe('DATE_ORDER');
    expect(found[0].confidencePenalty).toBe(3);
  });

  it('parses multilingual year claims and present markers', () => {
    expect(claimedYears(facts({ headline: 'Java 개발 5년' }))).toBe(5);
    expect(claimedYears(facts({ summary: '7 лет опыта' }))).toBe(7);
    const span = datedCareerSpan(
      facts({
        experience: [{ title: 'Dev', startDate: '2020', endDate: '현재' }],
      }),
    );
    expect(span).toBeGreaterThanOrEqual(5);
  });
});
