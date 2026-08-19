import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ProcessingGateway } from './processing.gateway';
import {
  DocumentStatus,
  ProcessingJobStatus,
  Role,
} from '../generated/prisma/enums';
import type { MembershipService } from '../common/membership/membership.service';
import type { Socket } from 'socket.io';

const SECRET = 'test-secret-token-that-is-long-enough-32';
const ORG_A = 'org-a';
const ORG_B = 'org-b';

function makeClient(token?: string): Socket & {
  join: jest.Mock;
  disconnect: jest.Mock;
} {
  return {
    handshake: { auth: token ? { token } : {}, headers: {} },
    join: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  } as unknown as Socket & { join: jest.Mock; disconnect: jest.Mock };
}

describe('ProcessingGateway', () => {
  const jwtService = new JwtService({ secret: SECRET });
  const configService = {
    getOrThrow: jest.fn(() => SECRET),
  } as unknown as ConfigService;

  let gateway: ProcessingGateway;
  let emit: jest.Mock;
  let to: jest.Mock;
  let findMembership: jest.Mock;

  beforeEach(() => {
    findMembership = jest
      .fn()
      .mockResolvedValue({ id: 'm1', role: Role.RECRUITER });
    gateway = new ProcessingGateway(jwtService, configService, {
      findMembership,
    } as unknown as MembershipService);
    emit = jest.fn();
    to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as never;
  });

  const signFor = (org?: string) =>
    jwtService.sign(
      { sub: 'u1', email: 'a@b.test', ...(org ? { org } : {}) },
      { secret: SECRET },
    );

  describe('handleConnection', () => {
    it('joins the org room only after verifying a LIVE membership', async () => {
      const client = makeClient(signFor(ORG_A));

      await gateway.handleConnection(client);

      expect(findMembership).toHaveBeenCalledWith('u1', ORG_A);
      expect(client.join).toHaveBeenCalledWith(`org:${ORG_A}`);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects a valid token whose membership was revoked', async () => {
      findMembership.mockResolvedValue(null);
      const client = makeClient(signFor(ORG_A));

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('disconnects a candidate-only token (no org claim)', async () => {
      const client = makeClient(signFor(undefined));

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('accepts the token from an Authorization header too', async () => {
      const client = makeClient();
      client.handshake.headers.authorization = `Bearer ${signFor(ORG_A)}`;

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith(`org:${ORG_A}`);
    });

    it('disconnects a socket with no token', async () => {
      const client = makeClient();

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('disconnects a socket whose token was signed with another secret', async () => {
      const forged = new JwtService({
        secret: 'a-totally-different-secret-val',
      }).sign({ sub: 'u1', org: ORG_B });
      const client = makeClient(forged);

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('disconnects on an expired token', async () => {
      const expired = jwtService.sign(
        { sub: 'u1', org: ORG_A },
        { secret: SECRET, expiresIn: '-1s' },
      );
      const client = makeClient(expired);

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('event emission is per-organization', () => {
    const event = {
      jobId: 'pj1',
      documentId: 'd1',
      status: ProcessingJobStatus.RUNNING,
      documentStatus: DocumentStatus.PARSING,
      progress: 10,
    };

    it('emits progress only into the owning organization room', () => {
      gateway.emitProgress(ORG_A, event);

      expect(to).toHaveBeenCalledWith(`org:${ORG_A}`);
      expect(to).not.toHaveBeenCalledWith(`org:${ORG_B}`);
      expect(emit).toHaveBeenCalledWith('processing.progress', event);
    });

    it('emits completion into the owning room', () => {
      gateway.emitCompleted(ORG_A, event);

      expect(to).toHaveBeenCalledWith(`org:${ORG_A}`);
      expect(emit).toHaveBeenCalledWith('processing.completed', event);
    });

    it('emits failure into the owning room', () => {
      gateway.emitFailed(ORG_B, {
        ...event,
        errorMessage: 'AI service disabled',
      });

      expect(to).toHaveBeenCalledWith(`org:${ORG_B}`);
      expect(emit).toHaveBeenCalledWith(
        'processing.failed',
        expect.objectContaining({ errorMessage: 'AI service disabled' }),
      );
    });

    it('does not throw when no socket server is attached yet', () => {
      gateway.server = undefined as never;

      expect(() => gateway.emitProgress(ORG_A, event)).not.toThrow();
    });
  });
});
