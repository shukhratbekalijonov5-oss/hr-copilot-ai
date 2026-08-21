/**
 * Recovering evidence from JavaScript-rendered pages, without a browser.
 *
 * Next.js, Nuxt, Remix, Astro and most modern portfolio hosts ship a nearly
 * empty `<body>` plus the page's real content as a JSON payload the client
 * hydrates from. The naive conclusion — "this page has no text, fail it" — is
 * wrong: the text is right there, one `JSON.parse` away.
 *
 * So this runs BEFORE any headless-render fallback, and in practice removes
 * the need for one on most Vercel/Netlify portfolios. It is cheap (no browser,
 * no extra request), deterministic, and it cannot execute anything: the
 * payloads are parsed as data, never evaluated.
 *
 * What it will not do is invent structure. Strings recovered this way have no
 * headings, so they land in an unnamed section — honest about the fact that
 * the page did not tell us what they were.
 */

import { WEB_INGESTION_LIMITS } from './web-ingestion.limits';
import {
  countWords,
  decodeEntities,
  normalizeWhitespace,
  type ExtractedSection,
} from './html-extract';

/** Strings shorter than this are labels and ids, not evidence. */
const MIN_STRING_CHARS = 40;
/** Depth guard: hydration payloads nest deeply and can be cyclic-ish in size. */
const MAX_DEPTH = 12;
const MAX_NODES = 20_000;

export interface EmbeddedExtraction {
  sections: ExtractedSection[];
  charCount: number;
}

export function extractEmbeddedJson(html: string): EmbeddedExtraction {
  const collected: string[] = [];
  const seen = new Set<string>();
  let budget = WEB_INGESTION_LIMITS.maxExtractedChars;

  const add = (value: string) => {
    const text = normalizeWhitespace(decodeEntities(value));
    if (text.length < MIN_STRING_CHARS || countWords(text) < 6) return;
    // Payloads repeat the same marketing string in half a dozen places.
    const key = text.slice(0, 160);
    if (seen.has(key)) return;
    seen.add(key);
    if (budget <= 0) return;
    collected.push(text.slice(0, budget));
    budget -= text.length;
  };

  for (const script of readScripts(html)) {
    if (budget <= 0) break;

    if (script.type === 'flight') {
      for (const value of readFlightStrings(script.body)) add(value);
      continue;
    }

    const parsed = safeParse(script.body);
    if (parsed === undefined) continue;
    walk(parsed, add);
  }

  if (collected.length === 0) return { sections: [], charCount: 0 };

  const text = collected
    .join('\n')
    .slice(0, WEB_INGESTION_LIMITS.maxSectionChars);
  return {
    sections: [{ name: null, heading: null, text }],
    charCount: text.length,
  };
}

interface EmbeddedScript {
  type: 'json' | 'flight';
  body: string;
}

/**
 * Pulls out the script bodies worth parsing.
 *
 * Only declared-JSON scripts and the Next.js flight stream are considered.
 * Arbitrary `<script>` bodies are NOT scanned for string literals: that would
 * drag analytics keys, feature flags and minified library text into a
 * candidate's evidence.
 */
function readScripts(html: string): EmbeddedScript[] {
  const scripts: EmbeddedScript[] = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    if (!body.trim()) continue;
    if (body.length > 2 * 1024 * 1024) continue;

    const type = /type\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    const id = /\bid\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1] ?? '';

    if (
      type === 'application/json' ||
      type === 'application/ld+json' ||
      /^__(NEXT|NUXT|remix|astro)/i.test(id)
    ) {
      scripts.push({ type: 'json', body });
      continue;
    }
    // React Server Components stream their payload through this call.
    if (body.includes('self.__next_f.push')) {
      scripts.push({ type: 'flight', body });
    }
    if (scripts.length >= 60) break;
  }
  return scripts;
}

function safeParse(body: string): unknown {
  const text = body.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The RSC flight format is a sequence of `self.__next_f.push([1,"<chunk>"])`
 * calls whose chunks concatenate into a JSON-ish stream. Rather than
 * reimplementing that format, the quoted JS string literals are decoded and
 * their human-readable runs are kept — a lossy read that is correct about
 * what it extracts even when it does not extract everything.
 */
function readFlightStrings(body: string): string[] {
  const out: string[] = [];
  const pattern = /self\.__next_f\.push\(\[\d+\s*,\s*"((?:[^"\\]|\\.)*)"/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    let decoded: string;
    try {
      decoded = JSON.parse(`"${match[1]}"`) as string;
    } catch {
      continue;
    }
    // Keep only runs that read like prose: letters, spaces and punctuation.
    for (const run of decoded.split(/["\\[\]{},]+/)) {
      const trimmed = run.trim();
      if (trimmed.length >= MIN_STRING_CHARS && /\s/.test(trimmed)) {
        out.push(trimmed);
      }
    }
    if (out.length >= 400) break;
  }
  return out;
}

/** Depth- and node-bounded walk over parsed JSON, collecting prose strings. */
function walk(root: unknown, add: (value: string) => void): void {
  let nodes = 0;
  const stack: { value: unknown; depth: number }[] = [
    { value: root, depth: 0 },
  ];

  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    if (depth > MAX_DEPTH) continue;
    if ((nodes += 1) > MAX_NODES) return;

    if (typeof value === 'string') {
      // Skip values that are plainly machinery: urls, hashes, css, base64.
      if (/^(https?:|data:|\/[\w./-]*$|#[0-9a-f]{3,8}$)/i.test(value)) continue;
      if (!/\s/.test(value)) continue;
      add(value);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) {
        stack.push({ value: item, depth: depth + 1 });
      }
    }
  }
}
