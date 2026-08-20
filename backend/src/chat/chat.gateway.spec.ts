import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ChatGateway } from './chat.gateway';
import { DomainEventsService } from '../common/events/domain-events.service';
import { ConversationParty } from '../generated/prisma/enums';
import type { ChatService } from './chat.service';
import type { Socket } from 'socket.io';

const SECRET = 'test-secret-token-that-is-long-enough-32';

function makeClient(token?: string): Socket & {
  join: jest.Mock;
  leave: jest.Mock;
  disconnect: jest.Mock;
  data: Record<string, unknown>;
} {
  return {
    handshake: { auth: token ? { token } : {}, headers: {} },
    data: {},
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  } as unknown as Socket & {
    join: jest.Mock;
    leave: jest.Mock;
    disconnect: jest.Mock;
    data: Record<string, unknown>;
  };
}

describe('ChatGateway', () => {
  const jwtService = new JwtService({ secret: SECRET });
  const configService = {
    getOrThrow: jest.fn(() => SECRET),
  } as unknown as ConfigService;

  let events: DomainEventsService;
  let chatService: {
    resolveConversationAccess: jest.Mock;
    sendMessageFromSocket: jest.Mock;
  };
  let gateway: ChatGateway;
  let emit: jest.Mock;
  let to: jest.Mock;
  let socketsLeave: jest.Mock;

  beforeEach(() => {
    events = new DomainEventsService();
    chatService = {
      resolveConversationAccess: jest.fn(),
      sendMessageFromSocket: jest.fn(),
    };
    gateway = new ChatGateway(
      jwtService,
      configService,
      chatService as unknown as ChatService,
      events,
    );
    emit = jest.fn();
    socketsLeave = jest.fn();
    to = jest.fn().mockReturnValue({ emit });
    gateway.server = {
      to,
      in: jest.fn().mockReturnValue({ socketsLeave }),
    } as never;
    gateway.onModuleInit();
  });

  const sign = () =>
    jwtService.sign({ sub: 'user-1', email: 'a@b.test' }, { secret: SECRET });

  describe('handshake', () => {
    it('authenticates the user and stores ONLY identity on the socket', async () => {
      const client = makeClient(sign());
      await gateway.handleConnection(client);

      expect(client.data.userId).toBe('user-1');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects a missing or invalid token', async () => {
      const missing = makeClient();
      await gateway.handleConnection(missing);
      expect(missing.disconnect).toHaveBeenCalled();

      const invalid = makeClient('not-a-jwt');
      await gateway.handleConnection(invalid);
      expect(invalid.disconnect).toHaveBeenCalled();
    });
  });

  describe('conversation.join — authorized live, never from client claims', () => {
    it('joins the room only when the database grants access', async () => {
      const client = makeClient(sign());
      await gateway.handleConnection(client);
      chatService.resolveConversationAccess.mockResolvedValue(
        ConversationParty.CANDIDATE,
      );

      const ack = await gateway.join(client, { conversationId: 'conv-1' });

      expect(chatService.resolveConversationAccess).toHaveBeenCalledWith(
        'user-1',
        'conv-1',
      );
      expect(client.join).toHaveBeenCalledWith('conversation:conv-1');
      expect(ack).toEqual({ joined: true });
    });

    it('a guessed conversation id joins nothing and confirms nothing', async () => {
      const client = makeClient(sign());
      await gateway.handleConnection(client);
      chatService.resolveConversationAccess.mockResolvedValue(null);

      const ack = await gateway.join(client, { conversationId: 'guessed' });

      expect(client.join).not.toHaveBeenCalled();
      expect(ack).toEqual({ joined: false, error: 'NOT_FOUND' });
    });
  });

  describe('message.send', () => {
    it('persists through the service and acks the message', async () => {
      const client = makeClient(sign());
      await gateway.handleConnection(client);
      chatService.sendMessageFromSocket.mockResolvedValue({ id: 'm1' });

      const ack = await gateway.send(client, {
        conversationId: 'conv-1',
        content: '  hello  ',
      });

      expect(chatService.sendMessageFromSocket).toHaveBeenCalledWith(
        'user-1',
        'conv-1',
        'hello',
      );
      expect(ack).toEqual({ message: { id: 'm1' } });
    });

    it('rejects empty and oversized content without touching the service', async () => {
      const client = makeClient(sign());
      await gateway.handleConnection(client);

      expect(
        await gateway.send(client, { conversationId: 'conv-1', content: '  ' }),
      ).toEqual({ error: 'INVALID' });
      expect(
        await gateway.send(client, {
          conversationId: 'conv-1',
          content: 'x'.repeat(4001),
        }),
      ).toEqual({ error: 'INVALID' });
      expect(chatService.sendMessageFromSocket).not.toHaveBeenCalled();
    });

    it('an unauthorized sender gets an opaque error', async () => {
      const client = makeClient(sign());
      await gateway.handleConnection(client);
      chatService.sendMessageFromSocket.mockResolvedValue(null);

      const ack = await gateway.send(client, {
        conversationId: 'conv-of-B',
        content: 'hi',
      });

      expect(ack).toEqual({ error: 'NOT_FOUND' });
    });
  });

  describe('event fan-out', () => {
    it('broadcasts persisted messages to the conversation room', () => {
      const message = { id: 'm1', conversationId: 'conv-1' };
      events.publish('chat.message.created', {
        conversationId: 'conv-1',
        message: message as never,
      });

      expect(to).toHaveBeenCalledWith('conversation:conv-1');
      expect(emit).toHaveBeenCalledWith('message.new', message);
    });

    it('vacancy close empties every affected room after notifying it', () => {
      events.publish('chat.conversations.deleted', {
        vacancyId: 'v1',
        reason: 'VACANCY_CLOSED',
        vacancyStatus: 'CLOSED',
        conversationIds: ['conv-1', 'conv-2'],
      });

      expect(emit).toHaveBeenCalledWith('conversation.closed', {
        conversationId: 'conv-1',
        reason: 'VACANCY_CLOSED',
      });
      expect(emit).toHaveBeenCalledWith('conversation.closed', {
        conversationId: 'conv-2',
        reason: 'VACANCY_CLOSED',
      });
      expect(socketsLeave).toHaveBeenCalledWith('conversation:conv-1');
      expect(socketsLeave).toHaveBeenCalledWith('conversation:conv-2');
    });

    it('an application deletion closes ONLY that conversation, with its own reason', () => {
      events.publish('chat.conversations.deleted', {
        vacancyId: 'v1',
        reason: 'APPLICATION_DELETED',
        vacancyStatus: null,
        conversationIds: ['conv-A'],
      });

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith('conversation.closed', {
        conversationId: 'conv-A',
        reason: 'APPLICATION_DELETED',
      });
      expect(socketsLeave).toHaveBeenCalledWith('conversation:conv-A');
      expect(to).not.toHaveBeenCalledWith('conversation:conv-B');
    });

    it('a rejection closes ONLY that conversation, with its own reason', () => {
      events.publish('chat.conversations.deleted', {
        vacancyId: 'v1',
        reason: 'CANDIDATE_REJECTED',
        vacancyStatus: null,
        conversationIds: ['conv-A'],
      });

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith('conversation.closed', {
        conversationId: 'conv-A',
        reason: 'CANDIDATE_REJECTED',
      });
      expect(socketsLeave).toHaveBeenCalledWith('conversation:conv-A');
      // Candidate B's room was never addressed.
      expect(to).not.toHaveBeenCalledWith('conversation:conv-B');
    });
  });
});
