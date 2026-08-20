import { Module } from '@nestjs/common';
import { CandidateAccountController } from './candidate-account.controller';
import { CandidateAccountService } from './candidate-account.service';
import { StorageModule } from '../storage/storage.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [StorageModule, QueueModule],
  controllers: [CandidateAccountController],
  providers: [CandidateAccountService],
  exports: [CandidateAccountService],
})
export class CandidateAccountModule {}
