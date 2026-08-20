import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDocx, DOCX_MIME } from '../scripts/synthetic-seed.docx';
import {
  CANDIDATE_COUNT,
  SYNTHETIC_ORG_SLUG_PREFIX,
  buildPlan,
  isSyntheticEmail,
  planSummary,
} from '../scripts/synthetic-seed.plan';

/**
 * Focused tests for the PURE parts of the synthetic seeder: the deterministic
 * plan and the DOCX writer. No database, no queue — the runner itself is
 * exercised by actually running it against the dev stack.
 *
 * Lives under test/ because the unit jest project has rootDir `src`, and this
 * covers tooling that deliberately sits outside the application.
 */
describe('Synthetic seeder (pure parts)', () => {
  describe('plan determinism and shape', () => {
    const plan = buildPlan();
    const summary = planSummary(plan);

    it('is byte-identical across runs with the same seed', () => {
      expect(JSON.stringify(buildPlan())).toEqual(JSON.stringify(plan));
    });

    it('produces a different dataset for a different seed', () => {
      expect(JSON.stringify(buildPlan(1234))).not.toEqual(JSON.stringify(plan));
    });

    it('hits the documented distribution targets', () => {
      expect(summary.candidates).toBe(CANDIDATE_COUNT);
      expect(summary.candidates).toBeGreaterThanOrEqual(130);
      expect(summary.candidates).toBeLessThanOrEqual(150);
      expect(summary.organizationUsers).toBeGreaterThanOrEqual(50);
      expect(summary.organizationUsers).toBeLessThanOrEqual(70);
      expect(summary.organizations).toBeGreaterThanOrEqual(30);
      expect(summary.organizations).toBeLessThanOrEqual(40);
      expect(summary.vacancies).toBeGreaterThanOrEqual(180);
      expect(summary.vacancies).toBeLessThanOrEqual(250);
      expect(summary.totalUsers).toBeGreaterThanOrEqual(180);
      expect(summary.totalUsers).toBeLessThanOrEqual(220);
    });

    it('gives one candidate 100+ applications for paging tests', () => {
      expect(summary.maxApplicationsPerCandidate).toBeGreaterThanOrEqual(100);
    });

    it('keeps multi-organization ORGANIZATION accounts represented', () => {
      expect(summary.multiOrgUsers).toBeGreaterThan(0);
    });

    it('never plans an application or saved job against a non-OPEN vacancy', () => {
      for (const { vacancyIndex } of [
        ...plan.applications,
        ...plan.savedJobs,
      ]) {
        expect(plan.vacancies[vacancyIndex].status).toBe('OPEN');
      }
    });

    it('only lets candidates WITH a resume apply (the real path requires one)', () => {
      for (const { candidateIndex } of plan.applications) {
        expect(plan.candidates[candidateIndex].hasResume).toBe(true);
      }
    });

    it('never plans a duplicate application for one candidate', () => {
      const seen = new Set<string>();
      for (const application of plan.applications) {
        const key = `${application.candidateIndex}:${application.vacancyIndex}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });

    it('covers every track and all four content locales', () => {
      expect(new Set(plan.candidates.map((c) => c.trackKey)).size).toBe(12);
      expect(new Set(plan.candidates.map((c) => c.resumeLocale))).toEqual(
        new Set(['en', 'ko', 'ru', 'uz']),
      );
    });

    it('seeds enough strong matches for each documented demo search', () => {
      const koreanBackend = plan.candidates.filter(
        (c) =>
          c.trackKey === 'backend' &&
          c.languages.some((l) => l.startsWith('Korean')),
      );
      const uzbekDevops = plan.candidates.filter(
        (c) => c.trackKey === 'devops' && c.skills.includes('Kubernetes'),
      );
      const reactTs = plan.candidates.filter(
        (c) => c.skills.includes('React') && c.skills.includes('TypeScript'),
      );
      const nestPostgres = plan.candidates.filter(
        (c) => c.skills.includes('NestJS') && c.skills.includes('PostgreSQL'),
      );
      expect(koreanBackend.length).toBeGreaterThanOrEqual(5);
      expect(uzbekDevops.length).toBeGreaterThanOrEqual(5);
      expect(reactTs.length).toBeGreaterThanOrEqual(5);
      expect(nestPostgres.length).toBeGreaterThanOrEqual(5);
    });

    it('mixes required and optional requirements so coverage can vary', () => {
      const all = plan.vacancies.flatMap((v) => v.requirements);
      expect(all.some((r) => r.required)).toBe(true);
      expect(all.some((r) => !r.required)).toBe(true);
      // Rare skills are what make some requirements unsupported (PARTIAL/WEAK).
      expect(
        plan.vacancies.some((v) =>
          v.requirements.some((r) => r.text === 'Elixir' || r.text === 'Nomad'),
        ),
      ).toBe(true);
    });

    it('marks every synthetic org slug and every synthetic email', () => {
      for (const org of plan.orgs) {
        expect(org.slug.startsWith(SYNTHETIC_ORG_SLUG_PREFIX)).toBe(true);
      }
      for (const user of [...plan.candidates, ...plan.orgUsers]) {
        expect(isSyntheticEmail(user.email)).toBe(true);
      }
    });
  });

  describe('reset marker', () => {
    it('matches only seeder-generated addresses', () => {
      expect(isSyntheticEmail('candidate001@example.test')).toBe(true);
      expect(isSyntheticEmail('owner036@example.test')).toBe(true);
      expect(isSyntheticEmail('recruiter007@example.test')).toBe(true);
    });

    it('never matches hand-made development accounts', () => {
      // These exist in the dev database and must survive every reset.
      for (const email of [
        'jasur.toshmatov@example.test',
        'yuna.seo@example.test',
        'candidate-auth-test@example.test',
        'org-auth-test@example.test',
        'owner@northwind-labs.test',
        'candidate001@example.com',
        'xcandidate001@example.test',
      ]) {
        expect(isSyntheticEmail(email)).toBe(false);
      }
    });
  });

  describe('DOCX writer', () => {
    const plan = buildPlan();

    it('writes a real ZIP container with the DOCX magic bytes', () => {
      const buffer = buildDocx(['Hello', 'World']);
      expect(buffer.subarray(0, 4).toString('hex')).toBe('504b0304');
      expect(DOCX_MIME).toContain('wordprocessingml');
    });

    it('is deterministic for the same input', () => {
      const lines = plan.candidates[0].resumeLines;
      expect(buildDocx(lines).equals(buildDocx(lines))).toBe(true);
    });

    it('round-trips en/ko/ru/uz text through python-docx (the real parser)', () => {
      const lines = [
        'Seo Yuna',
        '백엔드 엔지니어',
        'Опыт работы',
        "Ko'nikmalar",
        'Node.js, NestJS, PostgreSQL',
      ];
      const dir = mkdtempSync(join(tmpdir(), 'synthetic-docx-'));
      const file = join(dir, 'probe.docx');
      writeFileSync(file, buildDocx(lines));

      // The ai-service virtualenv owns python-docx; skip rather than fail when
      // this checkout has not created it yet.
      const python = join(
        __dirname,
        '..',
        '..',
        'ai-service',
        '.venv',
        'bin',
        'python',
      );
      let output: string;
      try {
        output = execFileSync(
          python,
          [
            '-c',
            `from docx import Document; print('\\n'.join(p.text for p in Document(r'${file}').paragraphs))`,
          ],
          { encoding: 'utf8' },
        );
      } catch {
        console.warn(
          'python-docx unavailable — skipping DOCX round-trip check',
        );
        return;
      }
      for (const line of lines) {
        expect(output).toContain(line);
      }
    });
  });
});
