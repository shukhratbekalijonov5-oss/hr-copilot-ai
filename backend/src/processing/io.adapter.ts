import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/**
 * Applies the same CORS policy to websockets as to REST: a single explicit
 * frontend origin with credentials enabled. Socket.io's default would allow
 * any origin, which is not acceptable alongside credentials.
 */
export class ProcessingIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly configService: ConfigService,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const origin = this.configService.get<string>(
      'app.frontendUrl',
      'http://localhost:3000',
    );
    return super.createIOServer(port, {
      ...options,
      cors: { origin: [origin], credentials: true },
    });
  }
}
