import { describeError } from './describe-error';

describe('describeError', () => {
  it('returns a plain error message', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  /**
   * The case this helper exists for: Prisma's own message is whitespace-only
   * noise and the real reason lives on `.code`.
   */
  it('surfaces the code Prisma hides behind a generic message', () => {
    const prismaStyle = Object.assign(
      new Error('\nInvalid `prisma.$queryRaw()` invocation:\n\n\n'),
      { code: 'ECONNREFUSED' },
    );

    const result = describeError(prismaStyle);

    expect(result).toContain('ECONNREFUSED');
    expect(result).not.toBe('');
  });

  it('never returns an empty string for a whitespace-only message', () => {
    expect(describeError(new Error('   \n  '))).toBe('Unknown error');
  });

  it('unwraps a nested cause', () => {
    const wrapped = new Error('query failed', {
      cause: new Error('connect ECONNREFUSED 127.0.0.1:5432'),
    });

    expect(describeError(wrapped)).toContain('ECONNREFUSED');
  });

  it('collapses newlines so the output stays on one log line', () => {
    expect(describeError(new Error('line one\n\nline two'))).toBe(
      'line one line two',
    );
  });

  it('does not repeat an identical message from the cause chain', () => {
    const wrapped = new Error('same', { cause: new Error('same') });

    expect(describeError(wrapped)).toBe('same');
  });

  it('stops rather than looping on a circular cause chain', () => {
    const a = new Error('a');
    (a as Error & { cause?: unknown }).cause = a;

    expect(describeError(a)).toBe('a');
  });

  it('truncates a very long message', () => {
    expect(describeError(new Error('x'.repeat(1000)))).toHaveLength(300);
  });

  it('handles a thrown string', () => {
    expect(describeError('something odd')).toBe('something odd');
  });

  it('falls back for a thrown non-error value', () => {
    expect(describeError({ weird: true })).toBe('Unknown error');
  });
});
