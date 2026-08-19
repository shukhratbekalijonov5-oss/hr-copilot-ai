import { Module } from '@nestjs/common';
import { CandidateAccountController } from './candidate-account.controller';
import { CandidateAccountService } from './candidate-account.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [CandidateAccountController],
  providers: [CandidateAccountService],
  exports: [CandidateAccountService],
})
export class CandidateAccountModule {}
