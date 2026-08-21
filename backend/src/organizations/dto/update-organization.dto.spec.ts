import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateOrganizationDto } from './update-organization.dto';

/**
 * The organization URL is optional, as the schema has it — so the two states
 * that matter are "a real address" and "cleared". A blank string is the second
 * one and must land as null, not as an empty string masquerading as a link.
 */
describe('UpdateOrganizationDto', () => {
  const parse = (payload: Record<string, unknown>) =>
    plainToInstance(UpdateOrganizationDto, payload);
  const errorsFor = (payload: Record<string, unknown>) =>
    validateSync(parse(payload)).map((error) => error.property);

  it('accepts an https address', () => {
    expect(errorsFor({ websiteUrl: 'https://northwind.example' })).toEqual([]);
  });

  it('accepts clearing the field, storing null', () => {
    const dto = parse({ websiteUrl: '   ' });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.websiteUrl).toBeNull();
  });

  it('rejects an address with no scheme', () => {
    expect(errorsFor({ websiteUrl: 'northwind.example' })).toContain(
      'websiteUrl',
    );
  });

  it('rejects a non-http scheme', () => {
    expect(errorsFor({ websiteUrl: 'javascript:alert(1)' })).toContain(
      'websiteUrl',
    );
  });

  it('still leaves the name editable and the slug absent', () => {
    expect(errorsFor({ name: 'Northwind Labs' })).toEqual([]);
    expect(parse({ name: 'Northwind Labs' })).not.toHaveProperty('slug');
  });
});
