import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { CandidateEvidenceLifecycleService } from './candidate-evidence.service';

/**
 * The evidence lifecycle, exported for everything that changes or reads a
 * candidate's evidence set.
 *
 * Deliberately its own module rather than a helper inside candidate-account:
 * the cascade is used by the personal-document path, the professional-links
 * path, the apply path and every AI surface that has to know which sources are
 * still live. One owner, imported by all of them.
 */
@Module({
  // Prisma, Storage and the AI client are @Global; only the queue producer
  // needs importing.
  imports: [QueueModule],
  providers: [CandidateEvidenceLifecycleService],
  exports: [CandidateEvidenceLifecycleService],
})
export class CandidateEvidenceModule {}
