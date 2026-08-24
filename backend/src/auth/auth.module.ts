import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthSessionService } from './auth-session.service';
import { LoginAttemptsService } from './login-attempts.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('auth.secretToken'),
        signOptions: {
          expiresIn: config.get<string>(
            'auth.tokenTtl',
            '1d',
          ) as JwtSignOptions['expiresIn'],
        },
      }),
      global: true,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthSessionService, LoginAttemptsService],
  exports: [AuthService, AuthSessionService],
})
export class AuthModule {}
