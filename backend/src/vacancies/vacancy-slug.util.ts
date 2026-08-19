import { randomBytes } from 'node:crypto';

/**
 * Builds a public job slug: `<title>-<org-slug>-<6 random hex chars>`.
 *
 * The random suffix — not the mutable title — is what actually guarantees
 * uniqueness; the words exist for humans and search engines. A title with no
 * ASCII letters or digits (e.g. a fully Korean title) falls back to 'job'
 * rather than producing an empty segment. Generated once at creation and never
 * regenerated: a shared link must survive title edits.
 */
export function buildPublicSlug(title: string, orgSlug: string): string {
  const titlePart =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'job';
  const suffix = randomBytes(3).toString('hex');
  return `${titlePart}-${orgSlug}-${suffix}`;
}
