import {
  isSitemapIndex,
  readAnchors,
  readCanonicalUrl,
  readHeading,
  readJobTitle,
  readMeta,
  readSitemapLocations,
  readTitleTag,
} from './careers-html';

/**
 * Reading a careers page from its standardized structure only.
 *
 * The fixtures are shaped after the two live sources. Linear's job rows really
 * do carry `class="X2WvJq_jobRow"` — a content hash regenerated on every
 * deploy — so the tests below deliberately vary the class names between
 * fixtures. Anything that started depending on them would fail here rather
 * than silently returning zero jobs in production, where a source claiming
 * completeness would read that as a company that stopped hiring.
 */

const BASE = 'https://linear.app/careers';

const INDEX = `<!doctype html><html><body>
  <nav><a href="/pricing" class="nav_1">Pricing</a></nav>
  <a href="/careers/069c4628-88d7-4e4d-b393-c996fc7f3076" class="aB3_jobRow">
    <div class="x"><span class="q1">Account Executive, Enterprise</span></div>
    <div class="y"><span class="q2">North America</span><span class="q3">Learn more</span></div>
  </a>
  <a href="/careers/453f1ba0-a35e-4ed2-8215-1514e0a30b92" class="aB3_jobRow">
    <div><span>Product Engineer</span></div><div><span>Remote</span></div>
  </a>
  <a href="https://linear.app/careers/069c4628-88d7-4e4d-b393-c996fc7f3076">duplicate</a>
</body></html>`;

describe('anchors', () => {
  const anchors = readAnchors(INDEX, BASE);

  it('resolves relative hrefs against the page', () => {
    expect(anchors.map((anchor) => anchor.href)).toContain(
      'https://linear.app/careers/453f1ba0-a35e-4ed2-8215-1514e0a30b92',
    );
  });

  it('keeps each text run in document order', () => {
    // Order is real document structure; the elements holding it are hashed
    // class names that change every deploy.
    const row = anchors.find((anchor) => anchor.href.includes('069c4628'))!;
    expect(row.parts[0]).toBe('Account Executive, Enterprise');
    expect(row.parts[1]).toBe('North America');
  });

  it("reads navigation links too — filtering is the caller's job", () => {
    expect(anchors.map((anchor) => anchor.href)).toContain(
      'https://linear.app/pricing',
    );
  });

  it('never looks at a class name', () => {
    const renamed = INDEX.replace(/aB3_jobRow/g, 'zZ9_totallyDifferent');
    expect(readAnchors(renamed, BASE)).toHaveLength(anchors.length);
  });

  it('drops a genuinely unparseable href instead of throwing', () => {
    expect(readAnchors('<a href="http://">x</a>', BASE)).toEqual([]);
  });

  it('resolves nonsense as a relative path, and lets the path rule reject it', () => {
    /*
     * `ht tp://%%%` is a valid RELATIVE reference, so URL resolution turns it
     * into a link under the page rather than failing. That is correct
     * behaviour and it is why this module does not decide what a job is: the
     * source's own anchored path pattern does, one layer up.
     */
    const anchor = readAnchors('<a href="ht tp://%%%">x</a>', BASE)[0];
    expect(anchor.href.startsWith('https://linear.app/')).toBe(true);
  });

  it('ignores script and style content inside an anchor', () => {
    const anchor = readAnchors(
      `<a href="/careers/x"><script>var a="Fake Title"</script><span>Real Title</span></a>`,
      BASE,
    )[0];
    expect(anchor.parts).toEqual(['Real Title']);
  });

  it('decodes entities in the label and the href', () => {
    const anchor = readAnchors(
      `<a href="/careers/x?a=1&amp;b=2">R&amp;D Engineer</a>`,
      BASE,
    )[0];
    expect(anchor.label).toBe('R&D Engineer');
    expect(anchor.href).toBe('https://linear.app/careers/x?a=1&b=2');
  });
});

describe('document metadata', () => {
  const DETAIL = `<html><head>
    <title>Account Executive, Enterprise - Linear Careers</title>
    <meta name="description" content="Apply for a career at Linear."/>
    <meta property="og:title" content="Account Executive, Enterprise - Linear Careers"/>
    <meta property="og:url" content="https://linear.app/careers/069c4628-88d7-4e4d-b393-c996fc7f3076"/>
  </head><body><h1>Account Executive,<br/> Enterprise</h1></body></html>`;

  it('reads og and named meta tags', () => {
    const meta = readMeta(DETAIL);
    expect(meta.get('og:title')).toContain('Account Executive');
    expect(meta.get('description')).toBe('Apply for a career at Linear.');
  });

  it('reads the title tag and the first heading', () => {
    expect(readTitleTag(DETAIL)).toBe(
      'Account Executive, Enterprise - Linear Careers',
    );
    // Linear writes the heading with a <br/> in the middle of the role name.
    expect(readHeading(DETAIL)).toBe('Account Executive, Enterprise');
  });

  it("strips the site's declared boilerplate suffix", () => {
    expect(readJobTitle(DETAIL, [' - Linear Careers'])).toBe(
      'Account Executive, Enterprise',
    );
  });

  it('never guesses at a suffix', () => {
    /*
     * Suffixes are declared per source rather than pattern-matched, because a
     * rule like "drop everything after the last dash" turns
     * "Engineer - Backend" into "Engineer".
     */
    expect(readJobTitle('<title>Engineer - Backend</title>', [])).toBe(
      'Engineer - Backend',
    );
  });

  it('falls back through og:title, <title>, <h1>', () => {
    expect(readJobTitle('<html><h1>Data Analyst</h1></html>')).toBe(
      'Data Analyst',
    );
    expect(readJobTitle('<html><body>nothing</body></html>')).toBeNull();
  });

  it("reads the page's own canonical URL", () => {
    expect(readCanonicalUrl(DETAIL, BASE)).toBe(
      'https://linear.app/careers/069c4628-88d7-4e4d-b393-c996fc7f3076',
    );
    expect(
      readCanonicalUrl('<link rel="canonical" href="/careers/abc"/>', BASE),
    ).toBe('https://linear.app/careers/abc');
    expect(readCanonicalUrl('<html></html>', BASE)).toBeNull();
  });

  it('keeps markup out of a title', () => {
    const title = readJobTitle(
      `<title>Engineer <script>alert(1)</script></title>`,
    );
    expect(title).not.toContain('<');
    expect(title).not.toContain('alert');
  });
});

describe('sitemaps', () => {
  const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://vercel.com/careers/engineering-manager-cdn-5701765004</loc></url>
      <url><loc><![CDATA[https://vercel.com/careers/solutions-architect-5806749004]]></loc></url>
      <url><loc>https://vercel.com/blog/something</loc><lastmod>2026-08-01</lastmod></url>
      <url><loc>not a url</loc></url>
    </urlset>`;

  it('reads every location, CDATA included', () => {
    const locations = readSitemapLocations(
      SITEMAP,
      'https://vercel.com/sitemap.xml',
    );
    expect(locations).toContain(
      'https://vercel.com/careers/engineering-manager-cdn-5701765004',
    );
    expect(locations).toContain(
      'https://vercel.com/careers/solutions-architect-5806749004',
    );
  });

  it('resolves a relative location and drops an unparseable one', () => {
    const locations = readSitemapLocations(
      '<urlset><url><loc>/careers/x</loc></url></urlset>',
      'https://vercel.com/sitemap.xml',
    );
    expect(locations).toEqual(['https://vercel.com/careers/x']);
  });

  it('recognizes a sitemap INDEX', () => {
    // Never followed: chasing child sitemaps turns a bounded read into a crawl
    // of a whole site.
    expect(isSitemapIndex('<sitemapindex><sitemap/></sitemapindex>')).toBe(
      true,
    );
    expect(isSitemapIndex(SITEMAP)).toBe(false);
  });

  it('expands no XML entities', () => {
    /*
     * A real XML parser pointed at a third-party document is an XXE waiting
     * for the one server that still resolves external entities. This reader
     * only knows how to find <loc>.
     */
    const attack = `<?xml version="1.0"?>
      <!DOCTYPE urlset [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
      <urlset><url><loc>https://vercel.com/careers/&xxe;</loc></url></urlset>`;
    const locations = readSitemapLocations(attack, 'https://vercel.com/');
    expect(locations.join(' ')).not.toContain('root:');
    expect(locations.join(' ')).toContain('vercel.com/careers/');
  });
});
