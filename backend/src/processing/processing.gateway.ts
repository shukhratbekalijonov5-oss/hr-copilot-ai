import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type {
  DocumentStatus,
  ProcessingJobStatus,
} from '../generated/prisma/enums';
import type { JwtPayload } from '../common/interfaces/authenticated-user.interface';

export interface ProcessingProgressEvent {
  jobId: string | null;
  documentId: string;
  status: ProcessingJobStatus;
  documentStatus: DocumentStatus;
  progress: number;
  errorMessage?: string;
}

/**
 * Minimal realtime channel for processing progress.
 *
 * Deliberately small: one room per organization, three event types, no
 * client→server commands. Clients authenticate with the same JWT they use for
 * REST; an unauthenticated socket is disconnected before it joins any room,
 * so a tenant can only ever receive its own events.
 */
// CORS for the socket server is applied by ProcessingIoAdapter, which reads
// the allowed origin from configuration (see src/processing/io.adapter.ts).
@WebSocketGateway({ namespace: 'processing' })
export class ProcessingGateway implements OnGatewayConnection {
  private readonly logger = new Logger(ProcessingGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

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
      await client.join(room(payload.org));
    } catch {
      // No detail to the client and nothing about the token in the logs.
      this.logger.debug('Rejected websocket connection with invalid token');
      client.disconnect(true);
    }
  }

  emitProgress(organizationId: string, event: ProcessingProgressEvent): void {
    this.server?.to(room(organizationId)).emit('processing.progress', event);
  }

  emitCompleted(organizationId: string, event: ProcessingProgressEvent): void {
    this.server?.to(room(organizationId)).emit('processing.completed', event);
  }

  emitFailed(organizationId: string, event: ProcessingProgressEvent): void {
    this.server?.to(room(organizationId)).emit('processing.failed', event);
  }
}

const room = (organizationId: string): string => `org:${organizationId}`;
