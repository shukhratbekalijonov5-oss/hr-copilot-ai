import { Module } from '@nestjs/common';
import { CandidatePreferencesController } from './candidate-preferences.controller';
import { CandidatePreferencesService } from './candidate-preferences.service';

/**
 * Candidate job preferences and the canonical job-intent resolver.
 *
 * A module of its own rather than a corner of CandidateAccountModule: every
 * candidate→jobs surface depends on the resolver, and keeping it here means
 * they depend on a small, single-purpose provider instead of the whole
 * job-seeker service. The dependency runs one way — consumers import this;
 * this imports none of them — so no cycle is possible.
 */
@Module({
  controllers: [CandidatePreferencesController],
  providers: [CandidatePreferencesService],
  exports: [CandidatePreferencesService],
})
export class CandidatePreferencesModule {}
