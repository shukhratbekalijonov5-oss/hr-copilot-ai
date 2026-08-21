/**
 * HTML → normalized evidence sections.
 *
 * A portfolio page is mostly not evidence: navigation, a cookie banner, a
 * footer with the same six links on every page, analytics, styling. Embedding
 * that noise makes retrieval worse — every page of a site starts to look alike
 * — so this module keeps the prose and headings and drops the chrome.
 *
 * It is a small tokenizer + stack walker rather than a regex pass or a DOM
 * library. Regexes cannot skip a whole `<nav>` subtree correctly, and a full
 * DOM parser is a large dependency (and a large attack surface) for a job that
 * is "find the text under the headings". Malformed markup degrades to *more*
 * text being kept, never to a subtree being swallowed: an unclosed element
 * stops suppressing at the end of its parent.
 *
 * Nothing here trusts the content. Extracted text is DATA — it is stored,
 * chunked, embedded and eventually shown to a recruiter beside its source URL,
 * and it never becomes an instruction (see the AI service's prompt rules) and
 * never becomes markup (the frontend renders it as text).
 */

import { WEB_INGESTION_LIMITS } from './web-ingestion.limits';

export interface ExtractedSection {
  /** Canonical section name, when a heading maps to one. */
  name: string | null;
  /** The heading as written on the page. Preserved even when `name` is null. */
  heading: string | null;
  text: string;
}

export interface ExtractedPage {
  title: string | null;
  description: string | null;
  sections: ExtractedSection[];
  /** Same-origin links found on the page, for bounded subpage discovery. */
  links: string[];
  /** Total characters of section text. */
  charCount: number;
}

/** Elements whose entire subtree is chrome, never evidence. */
const DROPPED_ELEMENTS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'form',
  'button',
  'select',
  'nav',
  'footer',
  'aside',
  'dialog',
  'head',
]);

/**
 * class/id substrings that mark a container as site furniture. Matched
 * case-insensitively against the concatenated class and id.
 *
 * Deliberately conservative: each entry names a thing that is furniture on
 * essentially every site. "sidebar" is here; "content" and "main" never are.
 */
const NOISE_PATTERNS =
  /(^|[-_ ])(nav|navbar|navigation|menu|breadcrumb|cookie|consent|gdpr|banner|sidebar|side-?bar|footer|header|masthead|subscribe|newsletter|social|share|advert|ads?|promo|popup|modal|skip-?link|pagination|toolbar|topbar|announcement)([-_ ]|$)/i;

/** Elements that end a text block when they close. */
const BLOCK_ELEMENTS = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'li',
  'dd',
  'dt',
  'td',
  'th',
  'blockquote',
  'pre',
  'figcaption',
  'address',
  'summary',
  'details',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'tr',
  'br',
  'hr',
]);

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Raw-text elements: their content is not markup and must be skipped whole. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);

/**
 * Canonical section names. Mirrors the resume section vocabulary the PDF
 * parser already produces, so a "Projects" heading on a website and a
 * "Projects" section in a CV land in the same place for retrieval.
 *
 * A heading that matches nothing keeps `name: null` and its original text —
 * forcing every heading into one of these would invent structure.
 */
const SECTION_KEYWORDS: [string, RegExp][] = [
  [
    'summary',
    /\b(about|about me|summary|profile|intro|introduction|bio|who i am)\b/i,
  ],
  // Bare "work" is deliberately absent: "Selected Work" and "My Work" are
  // project galleries, and this list is checked in order, so it would shadow
  // the projects rule below.
  [
    'experience',
    /\b(experience|employment|work history|career|professional background)\b/i,
  ],
  [
    'projects',
    /\b(projects?|portfolio|case stud(y|ies)|selected work|my work|builds?)\b/i,
  ],
  [
    'skills',
    /\b(skills?|technolog(y|ies)|tech stack|stack|tools|expertise|competenc(y|ies))\b/i,
  ],
  ['education', /\b(education|academic|studies|university|degrees?)\b/i],
  [
    'certifications',
    /\b(certificat(e|ions?)|licen[sc]es?|credentials?|awards?)\b/i,
  ],
  ['languages', /\b(languages?)\b/i],
  ['contact', /\b(contact|get in touch|reach me|hire me)\b/i],
];

export function extractHtml(html: string, baseUrl: string): ExtractedPage {
  const tokens = tokenize(html);

  const meta = readMeta(tokens);
  const blocks = collectBlocks(tokens);
  const links = collectLinks(tokens, baseUrl);

  return {
    title: meta.title,
    description: meta.description,
    ...toSections(blocks),
    links,
  };
}

/** Plain-text responses have no structure to find; keep them as one section. */
export function extractPlainText(text: string): ExtractedPage {
  const cleaned = normalizeWhitespace(text).slice(
    0,
    WEB_INGESTION_LIMITS.maxSectionChars,
  );
  return {
    title: null,
    description: null,
    sections: cleaned ? [{ name: null, heading: null, text: cleaned }] : [],
    links: [],
    charCount: cleaned.length,
  };
}

// --- tokenizer ---------------------------------------------------------------

type Token =
  | { kind: 'open'; name: string; attrs: string; selfClosing: boolean }
  | { kind: 'close'; name: string }
  | { kind: 'text'; text: string };

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  const length = html.length;

  while (index < length) {
    const next = html.indexOf('<', index);
    if (next === -1) {
      pushText(tokens, html.slice(index));
      break;
    }
    if (next > index) pushText(tokens, html.slice(index, next));

    // Comments, doctypes, CDATA — never content.
    if (html.startsWith('<!--', next)) {
      const end = html.indexOf('-->', next + 4);
      index = end === -1 ? length : end + 3;
      continue;
    }
    if (html.startsWith('<!', next)) {
      const end = html.indexOf('>', next);
      index = end === -1 ? length : end + 1;
      continue;
    }

    const isClose = html[next + 1] === '/';
    const nameStart = next + (isClose ? 2 : 1);
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(
      html.slice(nameStart, nameStart + 40),
    );
    if (!nameMatch) {
      // A bare "<" in prose. Treat it as text so "a < b" survives.
      pushText(tokens, '<');
      index = next + 1;
      continue;
    }

    const name = nameMatch[0].toLowerCase();
    const tagEnd = findTagEnd(html, nameStart + nameMatch[0].length);
    if (tagEnd === -1) {
      pushText(tokens, html.slice(next));
      break;
    }
    const attrs = html.slice(nameStart + nameMatch[0].length, tagEnd);

    if (isClose) {
      tokens.push({ kind: 'close', name });
      index = tagEnd + 1;
      continue;
    }

    const selfClosing =
      attrs.trimEnd().endsWith('/') || VOID_ELEMENTS.has(name);
    tokens.push({ kind: 'open', name, attrs, selfClosing });

    if (RAW_TEXT_ELEMENTS.has(name) && !selfClosing) {
      // Everything up to the matching close tag is text, not markup — a
      // `if (a < b)` inside a <script> must not be parsed as a tag.
      const closeIndex = indexOfCloseTag(html, name, tagEnd + 1);
      const raw = html.slice(
        tagEnd + 1,
        closeIndex === -1 ? length : closeIndex,
      );
      if (name === 'title') pushText(tokens, raw);
      tokens.push({ kind: 'close', name });
      index = closeIndex === -1 ? length : closeIndex + name.length + 3;
      continue;
    }

    index = tagEnd + 1;
  }

  return tokens;
}

function pushText(tokens: Token[], text: string): void {
  if (text) tokens.push({ kind: 'text', text });
}

/** Finds the `>` that ends a tag, respecting quoted attribute values. */
function findTagEnd(html: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < html.length; i += 1) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') return i;
  }
  return -1;
}

function indexOfCloseTag(html: string, name: string, from: number): number {
  const pattern = new RegExp(`</${name}\\s*>`, 'i');
  const match = pattern.exec(html.slice(from));
  return match ? from + match.index : -1;
}

// --- walking -----------------------------------------------------------------

interface Block {
  heading: string | null;
  text: string;
}

/**
 * Walks the token stream, suppressing chrome subtrees, and emits text blocks
 * tagged with the heading that was most recently in scope.
 */
function collectBlocks(tokens: Token[]): Block[] {
  const blocks: Block[] = [];
  const stack: string[] = [];

  /** Depth at which suppression started; null when not suppressing. */
  let suppressAt: number | null = null;
  let currentHeading: string | null = null;
  let buffer = '';
  let inHeading = false;

  const flush = () => {
    const text = normalizeWhitespace(buffer);
    buffer = '';
    if (!text) return;
    blocks.push({ heading: currentHeading, text });
  };

  for (const token of tokens) {
    if (token.kind === 'text') {
      if (suppressAt === null) buffer += decodeEntities(token.text);
      continue;
    }

    if (token.kind === 'open') {
      if (!token.selfClosing) stack.push(token.name);
      const depth = stack.length;

      if (suppressAt === null && shouldSuppress(token)) {
        flush();
        // A void/self-closing noise element has no subtree to suppress.
        if (!token.selfClosing) suppressAt = depth;
        continue;
      }
      if (suppressAt !== null) continue;

      if (BLOCK_ELEMENTS.has(token.name)) flush();
      if (HEADINGS.has(token.name)) {
        inHeading = true;
        buffer = '';
      }
      continue;
    }

    // close
    const depth = stack.length;
    // Pop to the matching open tag. An unclosed <div> inside a <section> must
    // not leave the stack permanently misaligned.
    const openIndex = stack.lastIndexOf(token.name);
    if (openIndex !== -1) stack.length = openIndex;

    if (suppressAt !== null) {
      if (depth <= suppressAt) suppressAt = null;
      continue;
    }

    if (HEADINGS.has(token.name) && inHeading) {
      const heading = normalizeWhitespace(buffer);
      buffer = '';
      inHeading = false;
      currentHeading = heading || currentHeading;
      continue;
    }
    if (BLOCK_ELEMENTS.has(token.name)) flush();
  }

  flush();
  return blocks;
}

function shouldSuppress(token: {
  kind: 'open';
  name: string;
  attrs: string;
}): boolean {
  if (DROPPED_ELEMENTS.has(token.name)) return true;

  const role = attr(token.attrs, 'role');
  if (
    role &&
    /^(navigation|banner|contentinfo|search|complementary|dialog)$/i.test(role)
  ) {
    return true;
  }
  if (attr(token.attrs, 'aria-hidden') === 'true') return true;
  if (/(^|\s)hidden(\s|=|$)/i.test(token.attrs)) return true;

  const identity = `${attr(token.attrs, 'class') ?? ''} ${attr(token.attrs, 'id') ?? ''}`;
  return identity.trim().length > 0 && NOISE_PATTERNS.test(identity);
}

function attr(attrs: string, name: string): string | null {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  ).exec(attrs);
  if (!match) return null;
  return match[2] ?? match[3] ?? match[4] ?? null;
}

function readMeta(tokens: Token[]): {
  title: string | null;
  description: string | null;
} {
  let title: string | null = null;
  let description: string | null = null;
  let ogTitle: string | null = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind !== 'open') continue;

    if (token.name === 'title' && !title) {
      const next = tokens[i + 1];
      if (next?.kind === 'text')
        title = normalizeWhitespace(decodeEntities(next.text));
      continue;
    }
    if (token.name !== 'meta') continue;

    const key = (
      attr(token.attrs, 'property') ??
      attr(token.attrs, 'name') ??
      ''
    ).toLowerCase();
    const content = attr(token.attrs, 'content');
    if (!content) continue;

    if (key === 'og:title' || key === 'twitter:title') {
      ogTitle ??= normalizeWhitespace(decodeEntities(content));
    }
    if (
      key === 'description' ||
      key === 'og:description' ||
      key === 'twitter:description'
    ) {
      description ??= normalizeWhitespace(decodeEntities(content));
    }
  }

  return { title: title || ogTitle, description };
}

/**
 * Same-origin links, for bounded subpage discovery.
 *
 * Cross-origin links are deliberately dropped here rather than filtered later:
 * a portfolio linking to GitHub, LinkedIn and a client's site must NOT turn
 * those into evidence sources. If a candidate wants their GitHub analysed they
 * add it as one of their three links — an explicit act of consent.
 */
function collectLinks(tokens: Token[], baseUrl: string): string[] {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  const found = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'open' || token.name !== 'a') continue;
    const href = attr(token.attrs, 'href');
    if (!href) continue;
    try {
      const resolved = new URL(decodeEntities(href), baseUrl);
      if (resolved.origin !== origin) continue;
      resolved.hash = '';
      found.add(resolved.toString());
    } catch {
      continue;
    }
    if (found.size >= 200) break;
  }
  return [...found];
}

// --- sectioning --------------------------------------------------------------

function toSections(blocks: Block[]): {
  sections: ExtractedSection[];
  charCount: number;
} {
  const sections: ExtractedSection[] = [];
  const seen = new Set<string>();
  let charCount = 0;

  for (const block of blocks) {
    // Repetition is the signature of chrome that survived suppression: the
    // same "Home About Contact" string on every page of a site. One copy is
    // enough evidence of anything.
    const fingerprint = `${block.heading ?? ''} ${block.text}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    // A two-word block is a link label, not evidence.
    if (block.text.length < 3 || countWords(block.text) < 2) continue;

    const last = sections[sections.length - 1];
    if (
      last &&
      last.heading === block.heading &&
      last.text.length + block.text.length + 1 <=
        WEB_INGESTION_LIMITS.maxSectionChars
    ) {
      last.text = `${last.text}\n${block.text}`;
      charCount += block.text.length + 1;
      continue;
    }

    sections.push({
      name: canonicalSection(block.heading),
      heading: block.heading,
      text: block.text.slice(0, WEB_INGESTION_LIMITS.maxSectionChars),
    });
    charCount += Math.min(
      block.text.length,
      WEB_INGESTION_LIMITS.maxSectionChars,
    );

    if (charCount >= WEB_INGESTION_LIMITS.maxExtractedChars) break;
  }

  return { sections, charCount };
}

/**
 * Maps a heading to a canonical section name, or leaves it unclassified.
 *
 * Two gates, both conservative. A heading must be SHORT — the same rule the
 * resume parser uses, because a long line that merely contains "about" is a
 * sentence, not a section label ("Things I think about at night" is not a
 * summary) — and it must then match a known vocabulary. Anything else keeps
 * `null` and its original text: inventing a section would put a fabricated
 * attribution behind a citation a human is meant to trust.
 */
export function canonicalSection(heading: string | null): string | null {
  if (!heading) return null;
  const trimmed = heading.trim();
  if (trimmed.length > 60 || countWords(trimmed) > 5) return null;
  for (const [name, pattern] of SECTION_KEYWORDS) {
    if (pattern.test(trimmed)) return name;
  }
  return null;
}

// --- text helpers ------------------------------------------------------------

/**
 * Collapses whitespace while PRESERVING paragraph breaks.
 *
 * Order matters: trimming around newlines with `\s*` first would eat the blank
 * lines themselves, so horizontal space is collapsed first, then the padding
 * around each newline, and only then are runs of blank lines capped. A lost
 * paragraph break merges two unrelated statements into one chunk.
 */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/[\u00a0\u200b\ufeff]/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  eacute: 'é',
  egrave: 'è',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  szlig: 'ß',
};

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g,
    (whole, body: string) => {
      if (body.startsWith('#')) {
        const code =
          body.startsWith('#x') || body.startsWith('#X')
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        // Control characters and invalid code points decode to nothing rather
        // than being reintroduced into stored text.
        if (!Number.isFinite(code) || code < 0x20 || code > 0x10ffff) return '';
        try {
          return String.fromCodePoint(code);
        } catch {
          return '';
        }
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    },
  );
}
