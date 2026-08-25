import type { NextFunction, Request, Response } from 'express';
import { noStoreMiddleware } from './no-store.middleware';

describe('noStoreMiddleware', () => {
  const run = (path: string, authorization?: string) => {
    const headers: Record<string, string> = {};
    const req = { path, headers: { authorization } } as unknown as Request;
    const res = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    } as unknown as Response;
    const next = jest.fn() as unknown as NextFunction;
    noStoreMiddleware('api')(req, res, next);
    expect(next).toHaveBeenCalled();
    return headers;
  };

  it('marks bearer-authenticated responses no-store', () => {
    expect(
      run('/api/candidate-account/me', 'Bearer token')['Cache-Control'],
    ).toBe('no-store, private');
  });

  it('marks auth routes no-store even without an Authorization header', () => {
    expect(run('/api/auth/login')['Cache-Control']).toBe('no-store, private');
    expect(run('/api/auth/refresh')['Cache-Control']).toBe('no-store, private');
  });

  it('leaves public unauthenticated content untouched (cacheable)', () => {
    expect(run('/api/public/jobs')['Cache-Control']).toBeUndefined();
    expect(run('/health/live')['Cache-Control']).toBeUndefined();
  });

  it('does not misfire on paths merely containing "auth"', () => {
    expect(run('/api/authors')['Cache-Control']).toBeUndefined();
  });
});
