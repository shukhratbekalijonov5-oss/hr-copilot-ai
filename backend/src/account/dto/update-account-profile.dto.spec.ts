import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateAccountProfileDto } from './update-account-profile.dto';

/**
 * "Optional in the DTO, required when present."
 *
 * The product rule is that a name and an email must exist on every account, so
 * the interesting cases are not the missing field (the client simply did not
 * change it) but the BLANK one — a user who cleared the box and pressed save.
 * Whitespace-only counts as blank; it must never be stored as a name.
 */
describe('UpdateAccountProfileDto', () => {
  const errorsFor = (payload: Record<string, unknown>) =>
    validateSync(plainToInstance(UpdateAccountProfileDto, payload)).map(
      (error) => error.property,
    );

  it('accepts a partial payload — an unsent field is simply unchanged', () => {
    expect(errorsFor({ fullName: 'Dana Reed' })).toEqual([]);
    expect(errorsFor({})).toEqual([]);
  });

  it('rejects an empty name', () => {
    expect(errorsFor({ fullName: '' })).toContain('fullName');
  });

  it('rejects a whitespace-only name', () => {
    expect(errorsFor({ fullName: '   ' })).toContain('fullName');
  });

  it('rejects an empty email', () => {
    expect(errorsFor({ email: '' })).toContain('email');
  });

  it('rejects a whitespace-only email', () => {
    expect(errorsFor({ email: '  ' })).toContain('email');
  });

  it('rejects a malformed email', () => {
    expect(errorsFor({ email: 'not-an-address' })).toContain('email');
  });

  it('accepts a valid email and normalises its case', () => {
    const dto = plainToInstance(UpdateAccountProfileDto, {
      email: '  Dana@Northwind.TEST ',
    });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.email).toBe('dana@northwind.test');
  });

  /**
   * Run through the SAME pipe main.ts installs, because that is what makes the
   * absence of `role`/`accountType` a rejection rather than a silently ignored
   * field. A privilege attribute must not be settable on yourself.
   */
  it('refuses a payload smuggling a privilege field', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const metadata = {
      type: 'body' as const,
      metatype: UpdateAccountProfileDto,
    };

    await expect(
      pipe.transform({ fullName: 'Dana Reed', role: 'OWNER' }, metadata),
    ).rejects.toThrow();
    await expect(
      pipe.transform(
        { fullName: 'Dana Reed', accountType: 'ORGANIZATION' },
        metadata,
      ),
    ).rejects.toThrow();
    await expect(
      pipe.transform({ fullName: 'Dana Reed' }, metadata),
    ).resolves.toEqual(expect.objectContaining({ fullName: 'Dana Reed' }));
  });
});
