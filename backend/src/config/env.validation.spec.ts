import { validateEnv } from './env.validation';
import configuration from './configuration';

const VALID = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  SECRET_TOKEN: 'a'.repeat(32),
};

describe('validateEnv', () => {
  it('accepts a minimal valid environment', () => {
    expect(() => validateEnv({ ...VALID })).not.toThrow();
  });

  it('requires DATABASE_URL', () => {
    expect(() => validateEnv({ SECRET_TOKEN: 'a'.repeat(32) })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('requires SECRET_TOKEN to be long enough to sign with', () => {
    expect(() => validateEnv({ ...VALID, SECRET_TOKEN: 'short' })).toThrow(
      /at least 32 characters/,
    );
  });

  it('never includes the offending value in the error message', () => {
    const secret = 'too-short-secret';
    try {
      validateEnv({ ...VALID, SECRET_TOKEN: secret });
      fail('expected validation to throw');
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).toContain('SECRET_TOKEN');
    }
  });

  it('rejects a port outside the valid range', () => {
    expect(() => validateEnv({ ...VALID, PORT: '70000' })).toThrow();
  });

  it('accepts an empty AI_SERVICE_URL while the Python service does not exist', () => {
    expect(() => validateEnv({ ...VALID, AI_SERVICE_URL: '' })).not.toThrow();
  });

  it('rejects a malformed AI_SERVICE_URL', () => {
    expect(() =>
      validateEnv({ ...VALID, AI_SERVICE_URL: 'not a url' }),
    ).toThrow(/AI_SERVICE_URL/);
  });

  it('rejects an unknown storage driver', () => {
    expect(() => validateEnv({ ...VALID, STORAGE_DRIVER: 'ftp' })).toThrow();
  });

  it('requires the R2 credentials when STORAGE_DRIVER=r2', () => {
    expect(() => validateEnv({ ...VALID, STORAGE_DRIVER: 'r2' })).toThrow(
      /R2_ACCOUNT_ID/,
    );
  });

  it('accepts STORAGE_DRIVER=r2 once every credential is present', () => {
    expect(() =>
      validateEnv({
        ...VALID,
        STORAGE_DRIVER: 'r2',
        R2_ACCOUNT_ID: 'account',
        R2_ACCESS_KEY_ID: 'key',
        R2_SECRET_ACCESS_KEY: 'secret',
        R2_BUCKET: 'bucket',
      }),
    ).not.toThrow();
  });
});

describe('configuration', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
  });
  afterAll(() => {
    process.env = original;
  });

  it('defaults the port to 3001 so it does not collide with the frontend', () => {
    delete process.env.PORT;
    expect(configuration().app.port).toBe(3001);
  });

  it('honours PORT when it is set', () => {
    process.env.PORT = '4005';
    expect(configuration().app.port).toBe(4005);
  });

  it('falls back to 3001 when PORT is not a number', () => {
    process.env.PORT = 'not-a-number';
    expect(configuration().app.port).toBe(3001);
  });

  it('defaults the frontend origin to port 3000', () => {
    delete process.env.FRONTEND_URL;
    expect(configuration().app.frontendUrl).toBe('http://localhost:3000');
  });

  it('defaults the storage driver to local so no cloud credentials are needed', () => {
    delete process.env.STORAGE_DRIVER;
    expect(configuration().storage.driver).toBe('local');
  });

  it('leaves the AI base URL empty by default', () => {
    delete process.env.AI_SERVICE_URL;
    expect(configuration().ai.baseUrl).toBe('');
  });
});
