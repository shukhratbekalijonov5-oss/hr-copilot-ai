import { ConfigService } from '@nestjs/config';
import { LocalStorageService } from './local-storage.service';

/**
 * The signed-link base is configuration, not a hardcoded localhost: native
 * mobile devices can only fetch these links when the base is a reachable
 * address. Signature verification is host-independent (key + expiry only),
 * so changing the base never invalidates existing links.
 */
describe('LocalStorageService signed URL base', () => {
  const build = (values: Record<string, unknown>) =>
    new LocalStorageService({
      get: (key: string, fallback?: unknown) => values[key] ?? fallback,
      getOrThrow: (key: string) => {
        const value = values[key];
        if (value === undefined) throw new Error(`missing ${key}`);
        return value;
      },
    } as unknown as ConfigService);

  const base = {
    'auth.secretToken': 'test-secret',
    'storage.localRoot': './storage-test',
  };

  it('mints links against the configured public base URL', async () => {
    const storage = build({
      ...base,
      'app.publicBaseUrl': 'http://192.168.0.10:3001/api',
    });
    const url = await storage.getSignedUrl('org-1/doc.pdf');
    expect(url).toMatch(
      /^http:\/\/192\.168\.0\.10:3001\/api\/documents\/download\?/,
    );
    expect(url).toContain('key=org-1%2Fdoc.pdf');
    expect(url).toContain('signature=');
  });

  it('a trailing slash in the configured base does not double up', async () => {
    const storage = build({
      ...base,
      'app.publicBaseUrl': 'http://192.168.0.10:3001/api/',
    });
    const url = await storage.getSignedUrl('org-1/doc.pdf');
    expect(url).toContain('http://192.168.0.10:3001/api/documents/download?');
  });

  it('defaults to the same-machine localhost base when unconfigured', async () => {
    const storage = build({ ...base, 'app.port': 3005 });
    const url = await storage.getSignedUrl('org-1/doc.pdf');
    expect(url).toMatch(/^http:\/\/localhost:3005\/api\/documents\/download\?/);
  });

  it('the same key+expiry signs identically regardless of base (links survive a base change)', async () => {
    const a = await build({
      ...base,
      'app.publicBaseUrl': 'http://192.168.0.10:3001/api',
    }).getSignedUrl('org-1/doc.pdf', 600);
    const b = await build(base).getSignedUrl('org-1/doc.pdf', 600);
    const sig = (u: string) => new URL(u).searchParams.get('signature');
    const exp = (u: string) => new URL(u).searchParams.get('expires');
    if (exp(a) === exp(b)) {
      expect(sig(a)).toBe(sig(b));
    }
  });
});
