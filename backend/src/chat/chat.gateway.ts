import { Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import type { JwtPayload } from '../common/interfaces/authenticated-user.interface';

/** Server→client events: `message.new`, `conversation.closed`. */

const MAX_MESSAGE_LENGTH = 4000;

interface SocketData {
  userId?: string;
}

/**
 * Realtime channel for interview chat, mirroring ProcessingGateway's
 * conventions (same JWT handshake, same adapter/CORS, one namespace).
 *
 * Trust model:
 *  - the handshake only authenticates the USER (candidate and organization
 *    accounts both connect here — unlike /processing, no org claim needed);
 *  - every room join and every send is authorized LIVE against the database
 *    through ChatService — never against client-supplied ids or anything
 *    cached on the socket;
 *  - unauthorized commands are answered with an error ack and no room state
 *    change, so a guessed conversationId confirms nothing.
 *
 * Message fan-out is event-driven: ChatService publishes
 * `chat.message.created` for BOTH REST and socket sends, so every connected
 * participant sees every message however it was sent. When a conversation is
 * hard-deleted — a vacancy closing, or a candidate being rejected —
 * `chat.conversations.deleted` empties exactly the affected rooms and carries
 * the reason. The rows are already gone when it fires, so a client that
 * misses the event still cannot read or send: every command re-authorizes.
 */
@WebSocketGateway({ namespace: 'chat' })
export class ChatGateway implements OnGatewayConnection, OnModuleInit {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly chatService: ChatService,
    private readonly events: DomainEventsService,
  ) {}

  onModuleInit(): void {
    this.events.on('chat.message.created', ({ conversationId, message }) => {
      this.server?.to(room(conversationId)).emit('message.new', message);
    });
    this.events.on(
      'chat.conversations.deleted',
      ({ conversationIds, reason }) => {
        for (const id of conversationIds) {
          const r = room(id);
          // The reason travels with the event — VACANCY_CLOSED and
          // CANDIDATE_REJECTED are distinguishable by the client, but both mean
          // the conversation no longer exists.
          this.server?.to(r).emit('conversation.closed', {
            conversationId: id,
            reason,
          });
          this.server?.in(r).socketsLeave(r);
        }
      },
    );
  }

  async handleConnection(client: Socket): Promise<void> {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      client.handshake.headers.authorization?.replace(/^Bearer /i, '');

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>('auth.secretToken'),
      });
      if (!payload.sub) {
        client.disconnect(true);
        return;
      }
      // Authentication only. Authorization happens per conversation, per
      // command, against live rows — the socket stores nothing but identity.
      (client.data as SocketData).userId = payload.sub;
    } catch {
      this.logger.debug('Rejected websocket connection with invalid token');
      client.disconnect(true);
    }
  }

  @SubscribeMessage('conversation.join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string } | undefined,
  ): Promise<{ joined: boolean; error?: string }> {
    const userId = (client.data as SocketData).userId;
    const conversationId = body?.conversationId;
    if (!userId || typeof conversationId !== 'string') {
      return { joined: false, error: 'INVALID' };
    }
    const party = await this.chatService.resolveConversationAccess(
      userId,
      conversationId,
    );
    if (!party) return { joined: false, error: 'NOT_FOUND' };
    await client.join(room(conversationId));
    return { joined: true };
  }

  @SubscribeMessage('conversation.leave')
  async leave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string } | undefined,
  ): Promise<{ left: boolean }> {
    if (typeof body?.conversationId === 'string') {
      await client.leave(room(body.conversationId));
    }
    return { left: true };
  }

  @SubscribeMessage('message.send')
  async send(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: { conversationId?: string; content?: string } | undefined,
  ): Promise<{ message?: unknown; error?: string }> {
    const userId = (client.data as SocketData).userId;
    const conversationId = body?.conversationId;
    const content =
      typeof body?.content === 'string' ? body.content.trim() : '';
    if (
      !userId ||
      typeof conversationId !== 'string' ||
      content.length === 0 ||
      content.length > MAX_MESSAGE_LENGTH
    ) {
      return { error: 'INVALID' };
    }
    try {
      const message = await this.chatService.sendMessageFromSocket(
        userId,
        conversationId,
        content,
      );
      if (!message) return { error: 'NOT_FOUND' };
      return { message };
    } catch {
      // Conversation deleted mid-send, or any other persistence failure —
      // never leak details over the socket.
      return { error: 'NOT_FOUND' };
    }
  }
}

const room = (conversationId: string): string =>
  `conversation:${conversationId}`;
