import { AccountController } from './account.controller';
import type { AccountService } from './account.service';

/**
 * The isolation guarantee for this whole module is structural: no account
 * route takes an id, so the caller's own token is the only thing that can name
 * a subject. This pins that down — a future "convenience" `:id` parameter
 * would have to break these tests to get in.
 */
describe('AccountController', () => {
  const service = {
    getMine: jest.fn().mockResolvedValue({ id: 'user-1' }),
    updateProfile: jest.fn().mockResolvedValue({ id: 'user-1' }),
    uploadAvatar: jest.fn().mockResolvedValue({ id: 'user-1' }),
    deleteAvatar: jest.fn().mockResolvedValue({ id: 'user-1' }),
  };
  const controller = new AccountController(
    service as unknown as AccountService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('edits only the authenticated caller, never a requested id', async () => {
    await controller.update('caller-id', { fullName: 'Dana Reed' });
    await controller.deleteAvatar('caller-id');

    expect(service.updateProfile).toHaveBeenCalledWith('caller-id', {
      fullName: 'Dana Reed',
    });
    expect(service.deleteAvatar).toHaveBeenCalledWith('caller-id');
  });

  it('exposes no route carrying a user id', () => {
    const paths = Object.getOwnPropertyNames(AccountController.prototype)
      .filter((name) => name !== 'constructor')
      .map(
        (name) =>
          (Reflect.getMetadata(
            'path',
            AccountController.prototype[
              name as keyof typeof AccountController.prototype
            ] as object,
          ) ?? '') as string,
      );

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(path).not.toContain(':');
  });
});
