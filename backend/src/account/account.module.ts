import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { StorageModule } from '../storage/storage.module';
import { MAX_AVATAR_BYTES } from './account-policy';

@Module({
  imports: [
    // Multer's own ceiling, so an oversized image is refused while it is still
    // arriving instead of being buffered into memory first. The service-level
    // validator still checks the real size — this is the outer bound, not the
    // rule.
    MulterModule.register({
      storage: memoryStorage(),
      limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
    }),
    StorageModule,
  ],
  controllers: [AccountController],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
