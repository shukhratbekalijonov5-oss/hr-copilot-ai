import {
  canonicalSection,
  countWords,
  decodeEntities,
  extractHtml,
  extractPlainText,
  normalizeWhitespace,
} from './html-extract';

const BASE = 'https://portfolio.example.com/';

const text = (html: string) =>
  extractHtml(html, BASE)
    .sections.map((section) => section.text)
    .join('\n');

describe('extractHtml — what survives', () => {
  it('keeps prose under its heading', () => {
    const page = extractHtml(
      `<html><body><main>
         <h2>Projects</h2>
         <p>Built a Kubernetes deployment for a logistics service handling nine
            thousand requests per second at peak.</p>
       </main></body></html>`,
      BASE,
    );

    expect(page.sections).toHaveLength(1);
    expect(page.sections[0].heading).toBe('Projects');
    expect(page.sections[0].name).toBe('projects');
    expect(page.sections[0].text).toContain('Kubernetes deployment');
  });

  it('reads the page title and description', () => {
    const page = extractHtml(
      `<html><head>
         <title>Ji-woo Han — Backend Engineer</title>
         <meta name="description" content="Backend engineer in Seoul.">
       </head><body><p>Some content about my work here.</p></body></html>`,
      BASE,
    );
    expect(page.title).toBe('Ji-woo Han — Backend Engineer');
    expect(page.description).toBe('Backend engineer in Seoul.');
  });

  it('falls back to the OpenGraph title', () => {
    const page = extractHtml(
      `<html><head><meta property="og:title" content="My Portfolio"></head>
       <body><p>Work I have done recently on distributed systems.</p></body></html>`,
      BASE,
    );
    expect(page.title).toBe('My Portfolio');
  });

  it('keeps list items and table cells', () => {
    const extracted = text(
      `<ul><li>Kubernetes and Helm for orchestration</li>
           <li>PostgreSQL for storage and reporting</li></ul>`,
    );
    expect(extracted).toContain('Kubernetes and Helm');
    expect(extracted).toContain('PostgreSQL for storage');
  });
});

describe('extractHtml — what is dropped', () => {
  it('drops scripts, styles and their contents', () => {
    const extracted = text(
      `<body>
         <script>var apiKey = "sk-secret-value"; if (a < b) { go(); }</script>
         <style>.hero { color: red }</style>
         <p>Real content about the projects I have shipped.</p>
       </body>`,
    );
    expect(extracted).not.toContain('sk-secret-value');
    expect(extracted).not.toContain('color: red');
    expect(extracted).toContain('Real content');
  });

  it('does not mis-parse "<" inside a script as a tag', () => {
    const extracted = text(
      `<body><script>if (x < y) { hide(); }</script>
       <p>Content that must still be extracted correctly here.</p></body>`,
    );
    expect(extracted).toContain('must still be extracted');
  });

  it('drops navigation, header, footer and aside subtrees', () => {
    const extracted = text(
      `<body>
         <nav><a href="/">Home</a><a href="/about">About</a></nav>
         <header><h1>My Site</h1></header>
         <main><p>The real evidence lives here in the main region.</p></main>
         <aside><p>Follow me on social media everywhere please</p></aside>
         <footer><p>Copyright 2026 all rights reserved everywhere</p></footer>
       </body>`,
    );
    expect(extracted).toContain('real evidence');
    expect(extracted).not.toContain('Follow me on social');
    expect(extracted).not.toContain('Copyright 2026');
  });

  it('drops containers whose class or id marks them as chrome', () => {
    const extracted = text(
      `<body>
         <div class="cookie-banner"><p>We use cookies to improve your visit</p></div>
         <div id="newsletter"><p>Subscribe to my newsletter for updates</p></div>
         <div class="content"><p>Designed and shipped a payments service.</p></div>
       </body>`,
    );
    expect(extracted).toContain('payments service');
    expect(extracted).not.toContain('cookies');
    expect(extracted).not.toContain('newsletter');
  });

  it('drops aria-hidden and role=navigation regions', () => {
    const extracted = text(
      `<body>
         <div role="navigation"><p>Skip to primary content please now</p></div>
         <div aria-hidden="true"><p>Decorative text nobody should read here</p></div>
         <p>Genuine description of my professional experience.</p>
       </body>`,
    );
    expect(extracted).toContain('Genuine description');
    expect(extracted).not.toContain('Skip to primary');
    expect(extracted).not.toContain('Decorative text');
  });

  it('keeps extracting after an UNCLOSED chrome element', () => {
    // Degrading to "more text kept" is the safe direction; swallowing the rest
    // of the document would silently lose a candidate's evidence.
    const extracted = text(
      `<body><section><nav><a href="/">Home</a></section>
       <p>Evidence that must survive a malformed navigation block.</p></body>`,
    );
    expect(extracted).toContain('must survive');
  });

  it('drops a block repeated verbatim (site-wide furniture)', () => {
    const page = extractHtml(
      `<body>
         <p>Available for backend engineering work in Seoul.</p>
         <p>Available for backend engineering work in Seoul.</p>
       </body>`,
      BASE,
    );
    expect(page.sections).toHaveLength(1);
  });

  it('drops single-word blocks that are really link labels', () => {
    // The threshold stops at one word on purpose. "Read more" survives, and
    // that is the right trade: a two-word block can carry real evidence
    // ("Terraform modules"), and losing a candidate's content is worse than
    // keeping a little chrome that the quality gate and dedupe will dilute.
    expect(text(`<body><p>Home</p><p>Projects</p></body>`)).toBe('');
  });
});

describe('extractHtml — links', () => {
  it('collects same-origin links only', () => {
    const page = extractHtml(
      `<body>
         <a href="/projects">Projects</a>
         <a href="https://github.com/someone">GitHub</a>
         <a href="https://linkedin.com/in/someone">LinkedIn</a>
       </body>`,
      BASE,
    );
    // A portfolio linking out to GitHub must NOT turn GitHub into evidence:
    // the candidate adds that themselves, as one of their three links.
    expect(page.links).toEqual(['https://portfolio.example.com/projects']);
  });
});

describe('decodeEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(
      decodeEntities('R&amp;D &mdash; caf&eacute; &#38; more &#x1F600;'),
    ).toBe('R&D — café & more 😀');
  });

  it('leaves an unknown entity untouched rather than guessing', () => {
    expect(decodeEntities('&notarealentity;')).toBe('&notarealentity;');
  });

  it('drops control characters smuggled as numeric entities', () => {
    expect(decodeEntities('a&#0;b&#10;c')).toBe('abc');
  });
});

describe('normalizeWhitespace / countWords', () => {
  it('collapses runs and non-breaking spaces', () => {
    expect(normalizeWhitespace('a   b\t\tc\n\n\n\nd')).toBe('a b c\n\nd');
  });

  it('counts words across scripts', () => {
    expect(countWords('Kubernetes 배포 파이프라인 автоматизация')).toBe(4);
  });
});

describe('canonicalSection', () => {
  it('maps recognised headings and leaves the rest null', () => {
    expect(canonicalSection('About me')).toBe('summary');
    expect(canonicalSection('Selected Work')).toBe('projects');
    expect(canonicalSection('Tech Stack')).toBe('skills');
    expect(canonicalSection('Education')).toBe('education');
    // Not forced into a bucket: the original heading is preserved instead.
    expect(canonicalSection('Things I think about at night')).toBeNull();
  });
});

describe('extractPlainText', () => {
  it('keeps a text/plain response as one unnamed section', () => {
    const page = extractPlainText('Line one\n\n\nLine two about my work.');
    expect(page.sections).toHaveLength(1);
    expect(page.sections[0].name).toBeNull();
    expect(page.sections[0].text).toBe('Line one\n\nLine two about my work.');
  });
});
