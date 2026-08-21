/**
 * Live end-to-end verification of the candidate evidence LIFECYCLE.
 *
 * Its sibling `verify-evidence-sources.ts` proves that files and links become
 * evidence. This one proves the opposite direction — that withdrawing evidence
 * actually withdraws it, everywhere:
 *
 *     the candidate deletes a source
 *         → it leaves their profile
 *         → it leaves their own AI
 *         → it leaves every organization they sent it to
 *         → it leaves JD Evidence, Summary, Ask, Questions, Compare, Search
 *         → the APPLICATION, its status and its history all survive
 *
 * Drives the real running stack over HTTP: Postgres, Redis, BullMQ, the AI
 * service and Qdrant. A verification aid, not product code — nothing in `src/`
 * imports it.
 *
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' \
 *     scripts/verify-evidence-lifecycle.ts
 *
 * ## Why the fixtures look like this
 *
 * Each source carries a unique term that appears in NO other source:
 *
 *   Resume.docx    → LIFECYCLEFILE (plus React/Node.js)
 *   Portfolio.docx → LIFECYCLEPORT (plus Kubernetes/Helm)
 *   Extra.docx     → LIFECYCLEKEEP  — the control, never deleted
 *
 * A retrieval assertion is then unambiguous: a hit on LIFECYCLEPORT can only
 * have come from the portfolio, so "gone after deletion" means gone, and the
 * control proves the deletion was surgical rather than a blanket wipe.
 *
 * ## Cleanup
 *
 * Fixtures are created under a unique per-run suffix and are NEVER cleaned up
 * by a pattern like `DELETE FROM users WHERE email LIKE '%@example.test'` —
 * that marker also belongs to the synthetic dev seeder, and using it once
 * destroyed the whole 200-user dataset. Delete by the exact ids this script
 * prints, or leave them; they are inert.
 */
import { buildDocx, DOCX_MIME } from './synthetic-seed.docx';

const API = process.env.VERIFY_API_URL ?? 'http://localhost:3001/api';
const RUN = Date.now().toString(36);
const PASSWORD = 'CorrectHorseBattery1!';

interface Step {
  scenario: string;
  name: string;
  ok: boolean;
  detail: string;
}

const results: Step[] = [];

function check(scenario: string, name: string, ok: boolean, detail = '') {
  results.push({ scenario, name, ok, detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api<T = any>(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    form?: FormData;
    expect?: number[];
  } = {},
): Promise<{ status: number; body: T }> {
  const method =
    options.method ?? (options.body || options.form ? 'POST' : 'GET');
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    body:
      options.form ?? (options.body ? JSON.stringify(options.body) : undefined),
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (options.expect && !options.expect.includes(response.status)) {
    throw new Error(
      `${method} ${path} → ${response.status}: ${text.slice(0, 300)}`,
    );
  }
  return { status: response.status, body };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(
  label: string,
  poll: () => Promise<T | null>,
  timeoutMs = 180_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await poll();
    if (value !== null) return value;
    await sleep(3_000);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function upload(token: string, name: string, lines: string[]) {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(buildDocx(lines))], { type: DOCX_MIME }),
    name,
  );
  return api(`/candidate-account/me/documents`, { token, form, expect: [201] });
}

/** Every source's text is disjoint, so a hit names its origin unambiguously. */
const RESUME = [
  'Ji-woo Han',
  'Frontend Engineer — Seoul',
  '',
  'Summary',
  'Frontend engineer building marketplace and logistics interfaces.',
  '',
  'Skills',
  'React, Node.js, TypeScript, LIFECYCLEFILE',
  '',
  'Experience',
  'Senior Frontend Engineer, Northwind Logistics (2021-2026).',
  'Built the dispatch console in React and the BFF layer in Node.js.',
];

const PORTFOLIO = [
  'Selected work',
  '',
  'Projects',
  'Ran production Kubernetes clusters and wrote the Helm charts for the',
  'platform team. Internal codename LIFECYCLEPORT.',
  'Migrated the deployment pipeline to Kubernetes across four services.',
];

const CONTROL = [
  'Certificate of Completion',
  '',
  'Certifications',
  'AWS Certified Solutions Architect - Associate. Reference LIFECYCLEKEEP.',
];

/** Does any hit's text contain this term? */
const mentions = (hits: any[], term: string) =>
  hits.some((hit: any) => (hit.text ?? '').includes(term));

async function main() {
  console.log(`\nEvidence-lifecycle verification run ${RUN}\nAPI: ${API}\n`);

  const orgSlug = `verify-lifecycle-${RUN}`;
  const hrEmail = `verify-lc-hr-${RUN}@example.test`;
  const seekerEmail = `verify-lc-seeker-${RUN}@example.test`;
  const rivalEmail = `verify-lc-rival-${RUN}@example.test`;

  const hr = await api('/auth/register/organization', {
    body: {
      organizationName: 'Lifecycle Verification Co',
      organizationSlug: orgSlug,
      fullName: 'Hyeon Park',
      email: hrEmail,
      password: PASSWORD,
    },
    expect: [201],
  });
  const hrToken = hr.body.accessToken;

  const seeker = await api('/auth/register/candidate', {
    body: { fullName: 'Ji-woo Han', email: seekerEmail, password: PASSWORD },
    expect: [201],
  });
  const seekerToken = seeker.body.accessToken;

  const rival = await api('/auth/register/candidate', {
    body: { fullName: 'Marcus Osei', email: rivalEmail, password: PASSWORD },
    expect: [201],
  });
  const rivalToken = rival.body.accessToken;

  console.log(`  fixture users: ${seeker.body.user.id} ${rival.body.user.id} ${hr.body.user.id}`);

  await api('/candidate-account/me', {
    token: seekerToken,
    method: 'PATCH',
    body: {
      headline: 'Frontend Engineer',
      location: 'Seoul',
      skills: ['React', 'TypeScript'],
    },
    expect: [200],
  });

  /* ------------------------------------------------------------------ E -- */
  console.log('\nScenario E — zero evidence: matching cannot run');

  const emptyState = await api('/candidate-account/me/evidence', {
    token: seekerToken,
    expect: [200],
  });
  check(
    'E',
    'a candidate with no files and no links reports zero evidence',
    emptyState.body.total === 0 && emptyState.body.canRunJobMatch === false,
    JSON.stringify(emptyState.body),
  );

  const refusedMatch = await api('/candidate-account/me/job-matches', {
    token: seekerToken,
    method: 'POST',
    body: {},
  });
  check(
    'E',
    'AI Job Match is REFUSED with a typed code, not answered from the profile',
    refusedMatch.status === 422 &&
      refusedMatch.body?.code === 'NO_CANDIDATE_EVIDENCE',
    `${refusedMatch.status} ${refusedMatch.body?.code}`,
  );

  /* ------------------------------------------------------------------ A -- */
  console.log('\nScenario A — evidence persists until the candidate deletes it');

  const resume = await upload(seekerToken, 'Resume.docx', RESUME);
  const portfolio = await upload(seekerToken, 'Portfolio.docx', PORTFOLIO);
  const control = await upload(seekerToken, 'Extra.docx', CONTROL);

  await waitFor('personal files to index', async () => {
    const list = await api('/candidate-account/me/documents', {
      token: seekerToken,
      expect: [200],
    });
    return list.body.data.every((d: any) => d.status === 'COMPLETED')
      ? list.body.data
      : null;
  });

  // A fresh session — a new login, exactly as a returning user gets.
  const relogin = await api('/auth/login', {
    body: { email: seekerEmail, password: PASSWORD },
    expect: [200, 201],
  });
  const freshToken = relogin.body.accessToken;
  const afterRelogin = await api('/candidate-account/me/documents', {
    token: freshToken,
    expect: [200],
  });
  check(
    'A',
    'saved evidence survives a logout/login round trip',
    afterRelogin.body.data.length === 3,
    `${afterRelogin.body.data.length} file(s) after re-login`,
  );

  const state = await api('/candidate-account/me/evidence', {
    token: seekerToken,
    expect: [200],
  });
  check(
    'A',
    'the evidence counter reflects what was saved',
    state.body.files === 3 && state.body.canRunJobMatch === true,
    JSON.stringify(state.body),
  );
  const revisionAfterUploads = state.body.evidenceRevision;
  check(
    'A',
    'adding evidence advanced the evidence revision',
    revisionAfterUploads > 0,
    `revision=${revisionAfterUploads}`,
  );

  /* ------------------------------------------------------------------ B -- */
  console.log('\nScenario B — the candidate’s own AI reads every source');

  const vacancy = await api('/vacancies', {
    token: hrToken,
    body: {
      title: 'Platform Engineer (React, Kubernetes)',
      description:
        'Platform team for our logistics product. React dispatch console, ' +
        'Kubernetes for deployment, Helm charts for the platform.',
      status: 'OPEN',
    },
    expect: [201],
  });
  const vacancyId = vacancy.body.id;
  const vacancySlug = vacancy.body.publicSlug;

  for (const requirement of [
    { text: 'Kubernetes and Helm', required: true },
    { text: 'React front-end development', required: true },
    { text: 'AWS certification', required: false },
  ]) {
    await api(`/vacancies/${vacancyId}/requirements`, {
      token: hrToken,
      body: requirement,
      expect: [201],
    });
  }
  await sleep(10_000);

  const matched = await api('/candidate-account/me/job-matches', {
    token: seekerToken,
    method: 'POST',
    body: {},
    expect: [200, 201],
  });
  check(
    'B',
    'with evidence present, matching runs and reports its revision',
    Array.isArray(matched.body.matches) &&
      matched.body.evidenceRevision === revisionAfterUploads &&
      matched.body.stale === false,
    `revision=${matched.body.evidenceRevision} stale=${matched.body.stale}`,
  );

  /* ------------------------------------------------------------------ C -- */
  console.log('\nScenario C/G — apply, then withdraw one source');

  await api(`/public/jobs/${vacancySlug}/apply`, {
    token: seekerToken,
    method: 'POST',
    expect: [201],
  });

  // A second applicant, for Compare and as a cross-candidate control.
  await upload(rivalToken, 'Marcus-Resume.docx', [
    'Marcus Osei',
    'Backend Engineer',
    '',
    'Skills',
    'Java, Spring Boot, Kafka, Kubernetes',
  ]);
  await waitFor('rival file to index', async () => {
    const list = await api('/candidate-account/me/documents', {
      token: rivalToken,
      expect: [200],
    });
    return list.body.data.every((d: any) => d.status === 'COMPLETED')
      ? list.body.data
      : null;
  });
  await api(`/public/jobs/${vacancySlug}/apply`, {
    token: rivalToken,
    method: 'POST',
    expect: [201],
  });

  const applicants = await api(`/vacancies/${vacancyId}/candidates`, {
    token: hrToken,
    expect: [200],
  });
  const rows: any[] = applicants.body.data ?? applicants.body;
  const candidateIdFor = (name: string) =>
    rows.find((row) => row.candidate?.fullName === name)?.candidate?.id;
  const candidateId = candidateIdFor('Ji-woo Han');
  const rivalCandidateId = candidateIdFor('Marcus Osei');

  await waitFor('submitted copies to index', async () => {
    const detail = await api(`/candidates/${candidateId}`, {
      token: hrToken,
      expect: [200],
    });
    return detail.body.documents?.length === 3 &&
      detail.body.documents.every((d: any) => d.status === 'COMPLETED')
      ? detail.body
      : null;
  });

  const beforeDelete = await api(`/candidates/${candidateId}`, {
    token: hrToken,
    expect: [200],
  });
  check(
    'C',
    'HR sees all three submitted files before any deletion',
    beforeDelete.body.documents.length === 3,
    beforeDelete.body.documents.map((d: any) => d.originalFileName).join(', '),
  );

  const searchBefore = await api('/search/evidence', {
    token: hrToken,
    body: { query: 'LIFECYCLEPORT Kubernetes Helm', limit: 10 },
    expect: [200, 201],
  });
  check(
    'C',
    'AI Search finds the portfolio by its unique term BEFORE deletion',
    mentions(searchBefore.body.results ?? [], 'LIFECYCLEPORT'),
    `${(searchBefore.body.results ?? []).length} hit(s)`,
  );

  const mapBefore = await api(
    `/candidates/${candidateId}/vacancies/${vacancyId}/evidence-map`,
    { token: hrToken, method: 'POST', body: {}, expect: [200, 201] },
  );
  const k8sBefore = (mapBefore.body.requirements ?? []).find((r: any) =>
    /kubernetes/i.test(r.requirement?.text ?? ''),
  );
  check(
    'C',
    'JD Evidence maps the Kubernetes requirement to the portfolio',
    k8sBefore?.status === 'EVIDENCE_FOUND',
    `${k8sBefore?.status} (${(k8sBefore?.evidence ?? [])
      .map((e: any) => e.fileName)
      .join(', ')})`,
  );

  const askBefore = await api('/ai/answer', {
    token: hrToken,
    body: {
      query: 'What does this candidate’s evidence show about Kubernetes?',
      candidateId,
      vacancyId,
    },
    expect: [200, 201],
  });
  check(
    'C',
    'Ask answers from the portfolio before deletion',
    askBefore.body.status === 'GROUNDED',
    `${askBefore.body.status}, ${(askBefore.body.citations ?? []).length} citation(s)`,
  );

  /* -------------------------------------------------------- the deletion -- */
  console.log('\nScenario D/F/H — deleting ONE source removes it everywhere');

  const deleteResponse = await api(
    `/candidate-account/me/documents/${portfolio.body.id}`,
    { token: seekerToken, method: 'DELETE', expect: [200] },
  );
  check(
    'D',
    'the candidate can delete their own file',
    deleteResponse.body?.deleted === true,
    JSON.stringify(deleteResponse.body),
  );

  const afterState = await api('/candidate-account/me/evidence', {
    token: seekerToken,
    expect: [200],
  });
  check(
    'D',
    'the deletion advanced the evidence revision (old matches become stale)',
    afterState.body.evidenceRevision > revisionAfterUploads,
    `${revisionAfterUploads} → ${afterState.body.evidenceRevision}`,
  );

  const remaining = await api('/candidate-account/me/documents', {
    token: seekerToken,
    expect: [200],
  });
  check(
    'H',
    'the OTHER personal files are untouched',
    remaining.body.data.length === 2 &&
      remaining.body.data.some((d: any) => d.id === resume.body.id) &&
      remaining.body.data.some((d: any) => d.id === control.body.id),
    remaining.body.data.map((d: any) => d.originalFileName).join(', '),
  );

  // Eviction is queued; give the worker a moment before asserting on Qdrant.
  await sleep(6_000);

  const detailAfter = await api(`/candidates/${candidateId}`, {
    token: hrToken,
    expect: [200],
  });
  check(
    'F',
    'HR Candidate Detail stops showing the withdrawn file automatically',
    detailAfter.body.documents.length === 2 &&
      !detailAfter.body.documents.some((d: any) =>
        /Portfolio/.test(d.originalFileName),
      ),
    detailAfter.body.documents.map((d: any) => d.originalFileName).join(', '),
  );

  const searchAfter = await api('/search/evidence', {
    token: hrToken,
    body: { query: 'LIFECYCLEPORT Kubernetes Helm', limit: 10 },
    expect: [200, 201],
  });
  check(
    'F',
    'AI Search no longer surfaces the candidate by the withdrawn term',
    !mentions(searchAfter.body.results ?? [], 'LIFECYCLEPORT'),
    `${(searchAfter.body.results ?? []).length} hit(s)`,
  );

  const controlSearch = await api('/search/evidence', {
    token: hrToken,
    body: { query: 'LIFECYCLEKEEP AWS certification', limit: 10 },
    expect: [200, 201],
  });
  check(
    'H',
    'the SURVIVING file is still searchable (the delete was surgical)',
    mentions(controlSearch.body.results ?? [], 'LIFECYCLEKEEP'),
    `${(controlSearch.body.results ?? []).length} hit(s)`,
  );

  const mapAfter = await api(
    `/candidates/${candidateId}/vacancies/${vacancyId}/evidence-map`,
    { token: hrToken, expect: [200] },
  );
  const k8sStale = (mapAfter.body.requirements ?? []).find((r: any) =>
    /kubernetes/i.test(r.requirement?.text ?? ''),
  );
  check(
    'F',
    'the STORED JD Evidence verdict was invalidated, not left standing',
    k8sStale?.status === null,
    `status=${k8sStale?.status} evidence=${(k8sStale?.evidence ?? []).length}`,
  );

  const mapRerun = await api(
    `/candidates/${candidateId}/vacancies/${vacancyId}/evidence-map`,
    { token: hrToken, method: 'POST', body: {}, expect: [200, 201] },
  );
  const k8sAfter = (mapRerun.body.requirements ?? []).find((r: any) =>
    /kubernetes/i.test(r.requirement?.text ?? ''),
  );
  check(
    'F',
    're-running JD Evidence cannot find the withdrawn evidence again',
    k8sAfter?.status !== 'EVIDENCE_FOUND' &&
      !(k8sAfter?.evidence ?? []).some((e: any) =>
        /Portfolio/.test(e.fileName ?? ''),
      ),
    `${k8sAfter?.status} (${(k8sAfter?.evidence ?? [])
      .map((e: any) => e.fileName)
      .join(', ')})`,
  );

  // The lifecycle claim is that the SURVIVING files are still retrieved and
  // still cited. Which classification band the mapper lands in
  // (EVIDENCE_FOUND vs NEEDS_HUMAN_REVIEW) is a threshold property of the
  // requirement matcher, not of deletion, and asserting on it here would make
  // this script fail for reasons that have nothing to do with the lifecycle.
  const rerunCitations = (mapRerun.body.requirements ?? []).flatMap(
    (r: any) => r.evidence ?? [],
  );
  check(
    'H',
    'the SURVIVING files are still retrieved and cited after the deletion',
    rerunCitations.some((e: any) => /Resume|Extra/.test(e.fileName ?? '')),
    rerunCitations.map((e: any) => e.fileName).join(', ') || 'nothing cited',
  );
  check(
    'H',
    'and NOTHING from the withdrawn source is cited anywhere in the map',
    !rerunCitations.some((e: any) => /Portfolio/.test(e.fileName ?? '')),
    `${rerunCitations.length} citation(s), none from Portfolio.docx`,
  );

  const askAfter = await api('/ai/answer', {
    token: hrToken,
    body: {
      query: 'What does this candidate’s evidence show about Kubernetes?',
      candidateId,
      vacancyId,
    },
    expect: [200, 201],
  });
  const askCitations = askAfter.body.citations ?? [];
  check(
    'F',
    'Ask cites nothing from the withdrawn source',
    !askCitations.some((c: any) => /Portfolio/.test(c.fileName ?? '')) &&
      !JSON.stringify(askAfter.body).includes('LIFECYCLEPORT'),
    `${askAfter.body.status}, ${askCitations.length} citation(s)`,
  );

  const summaryAfter = await api(`/ai/candidates/${candidateId}/summary`, {
    token: hrToken,
    method: 'POST',
    body: { vacancyId },
    expect: [200, 201],
  });
  check(
    'F',
    'AI Summary cites nothing from the withdrawn source',
    !(summaryAfter.body.citations ?? []).some((c: any) =>
      /Portfolio/.test(c.sourceTitle ?? c.fileName ?? ''),
    ) && !JSON.stringify(summaryAfter.body).includes('LIFECYCLEPORT'),
    (summaryAfter.body.citations ?? [])
      .map((c: any) => c.sourceTitle ?? c.fileName)
      .join(', '),
  );

  const questionsAfter = await api(
    `/ai/candidates/${candidateId}/vacancies/${vacancyId}/interview-questions`,
    { token: hrToken, method: 'POST', body: {}, expect: [200, 201] },
  );
  check(
    'F',
    'Interview Questions draw on nothing from the withdrawn source',
    !JSON.stringify(questionsAfter.body).includes('LIFECYCLEPORT'),
    `${(questionsAfter.body.questions ?? []).length} question(s)`,
  );

  const rivalMap = await api(
    `/candidates/${rivalCandidateId}/vacancies/${vacancyId}/evidence-map`,
    { token: hrToken, method: 'POST', body: {}, expect: [200, 201] },
  );
  const rivalRequirements = rivalMap.body.requirements ?? [];
  const rivalCitations = rivalRequirements.flatMap((r: any) => r.evidence ?? []);
  check(
    'H',
    'ANOTHER candidate’s map still runs and still cites their OWN evidence',
    // Every requirement was classified (none left un-run), and the evidence
    // behind them is Marcus's own file — one candidate's deletion cannot reach
    // into another's analysis.
    rivalRequirements.length > 0 &&
      rivalRequirements.every((r: any) => r.status !== null) &&
      rivalCitations.every((e: any) => /Marcus/.test(e.fileName ?? '')),
    `${rivalRequirements.map((r: any) => r.status).join(', ')} | cites ` +
      `${[...new Set(rivalCitations.map((e: any) => e.fileName))].join(', ') || 'nothing'}`,
  );

  /* ------------------------------------------------------------------ G -- */
  console.log('\nScenario G — the APPLICATION survives the withdrawal');

  const myApplications = await api('/candidate-account/me/applications', {
    token: seekerToken,
    expect: [200],
  });
  const application = (myApplications.body.data ?? [])[0];
  check(
    'G',
    'the application, its status and its vacancy association all remain',
    Boolean(application) &&
      application.vacancy?.title?.includes('Platform Engineer'),
    `status=${application?.status} vacancy=${application?.vacancy?.title}`,
  );

  const stillListed = (applicants.body.data ?? applicants.body).length;
  const applicantsAfter = await api(`/vacancies/${vacancyId}/candidates`, {
    token: hrToken,
    expect: [200],
  });
  check(
    'G',
    'the candidate is still an applicant on the recruiter’s vacancy',
    (applicantsAfter.body.data ?? applicantsAfter.body).length === stillListed,
    `${(applicantsAfter.body.data ?? applicantsAfter.body).length} applicant(s)`,
  );

  /* ------------------------------------------------------------------ I -- */
  console.log('\nScenario I — deleting EVERY source empties the AI, not the account');

  for (const id of [resume.body.id, control.body.id]) {
    await api(`/candidate-account/me/documents/${id}`, {
      token: seekerToken,
      method: 'DELETE',
      expect: [200],
    });
  }
  await sleep(6_000);

  const emptyAgain = await api('/candidate-account/me/evidence', {
    token: seekerToken,
    expect: [200],
  });
  check(
    'I',
    'the candidate is back to zero evidence',
    emptyAgain.body.total === 0 && emptyAgain.body.canRunJobMatch === false,
    JSON.stringify(emptyAgain.body),
  );

  const refusedAgain = await api('/candidate-account/me/job-matches', {
    token: seekerToken,
    method: 'POST',
    body: {},
  });
  check(
    'I',
    'AI Job Match refuses again once everything is withdrawn',
    refusedAgain.status === 422 &&
      refusedAgain.body?.code === 'NO_CANDIDATE_EVIDENCE',
    `${refusedAgain.status} ${refusedAgain.body?.code}`,
  );

  const emptyDetail = await api(`/candidates/${candidateId}`, {
    token: hrToken,
    expect: [200],
  });
  check(
    'I',
    'HR sees the application with NO current evidence',
    emptyDetail.body.documents.length === 0 &&
      (emptyDetail.body.linkSources ?? []).length === 0 &&
      (emptyDetail.body.applications ?? []).length > 0,
    `${emptyDetail.body.documents.length} file(s), ` +
      `${(emptyDetail.body.applications ?? []).length} application(s)`,
  );

  const emptySearch = await api('/search/evidence', {
    token: hrToken,
    body: { query: 'LIFECYCLEFILE LIFECYCLEKEEP LIFECYCLEPORT', limit: 10 },
    expect: [200, 201],
  });
  check(
    'I',
    'none of the withdrawn terms find the candidate any more',
    !['LIFECYCLEFILE', 'LIFECYCLEKEEP', 'LIFECYCLEPORT'].some((term) =>
      mentions(emptySearch.body.results ?? [], term),
    ),
    `${(emptySearch.body.results ?? []).length} hit(s)`,
  );

  const emptyAsk = await api('/ai/answer', {
    token: hrToken,
    body: {
      query: 'Summarise what this candidate’s evidence shows.',
      candidateId,
      vacancyId,
    },
    expect: [200, 201],
  });
  check(
    'I',
    'Ask reports insufficient evidence rather than improvising',
    emptyAsk.body.status !== 'GROUNDED' &&
      (emptyAsk.body.citations ?? []).length === 0,
    `${emptyAsk.body.status}, ${(emptyAsk.body.citations ?? []).length} citation(s)`,
  );

  /* ------------------------------------------------------------ summary -- */
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed`,
  );
  if (failed.length > 0) {
    console.log('\nFailures:');
    for (const f of failed) {
      console.log(`  [${f.scenario}] ${f.name} — ${f.detail}`);
    }
    process.exitCode = 1;
  }
  console.log(
    `\nFixtures left behind (delete by EXACT id, never by email pattern):\n` +
      `  ${seekerEmail}\n  ${rivalEmail}\n  ${hrEmail}\n  org slug ${orgSlug}\n`,
  );
}

main().catch((error) => {
  console.error('\nVerification aborted:', error);
  process.exitCode = 1;
});
