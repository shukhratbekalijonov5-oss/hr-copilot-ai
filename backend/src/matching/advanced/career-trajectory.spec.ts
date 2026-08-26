import { buildCareerTrajectory } from './career-trajectory';
import { buildProfileFacts } from './profile-facts';

const facts = (experience: unknown[]) =>
  buildProfileFacts({
    headline: null,
    summary: null,
    location: null,
    skills: [],
    languages: [],
    experience,
    education: [],
  });

describe('career trajectory', () => {
  it('recent aligned roles with a title-stated rise is STRONG', () => {
    const result = buildCareerTrajectory(
      facts([
        {
          title: 'Senior Backend Engineer',
          startDate: '2024',
          endDate: 'present',
        },
        { title: 'Backend Engineer', startDate: '2021', endDate: '2024' },
      ]),
      'Backend Engineer',
    );
    expect(result.status).toBe('STRONG');
    expect(result.reasons.join(' ')).toContain('rose');
  });

  it('aligned without a demonstrated rise is ALIGNED — no promotion is invented', () => {
    const result = buildCareerTrajectory(
      facts([
        { title: 'Backend Engineer', startDate: '2023', endDate: 'present' },
        { title: 'Backend Engineer', startDate: '2020', endDate: '2023' },
      ]),
      'Backend Engineer',
    );
    expect(result.status).toBe('ALIGNED');
    expect(result.score).toBe(0.8);
  });

  it('mixed recent families is MIXED', () => {
    const result = buildCareerTrajectory(
      facts([
        { title: 'Backend Engineer', startDate: '2024' },
        { title: 'Frontend Developer', startDate: '2022' },
      ]),
      'Backend Engineer',
    );
    expect(result.status).toBe('MIXED');
  });

  it('recent roles in an unrelated family is WEAK', () => {
    const result = buildCareerTrajectory(
      facts([{ title: 'Frontend Developer', startDate: '2024' }]),
      'Data Engineer',
    );
    expect(result.status).toBe('WEAK');
  });

  it('no classifiable data is UNKNOWN with a null score — never guessed', () => {
    expect(buildCareerTrajectory(facts([]), 'Backend Engineer').status).toBe(
      'UNKNOWN',
    );
    expect(
      buildCareerTrajectory(
        facts([{ title: 'Chef', startDate: '2024' }]),
        'Backend Engineer',
      ).status,
    ).toBe('UNKNOWN');
    expect(
      buildCareerTrajectory(
        facts([{ title: 'Backend Engineer' }]),
        'Head of Coffee',
      ).status,
    ).toBe('UNKNOWN');
  });
});
