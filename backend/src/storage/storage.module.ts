import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import { LocalStorageService } from './local-storage.service';
import { R2StorageService } from './r2-storage.service';

/**
 * Binds the StorageService token to a driver chosen by STORAGE_DRIVER.
 * `local` is the default so the stack runs with no cloud credentials.
 */
@Global()
@Module({
  providers: [
    LocalStorageService,
    {
      provide: StorageService,
      inject: [ConfigService, LocalStorageService],
      useFactory: (
        configService: ConfigService,
        local: LocalStorageService,
      ): StorageService => {
        const driver = configService.get<string>('storage.driver', 'local');
        return driver === 'r2' ? new R2StorageService(configService) : local;
      },
    },
  ],
  exports: [StorageService, LocalStorageService],
})
export class StorageModule {}
