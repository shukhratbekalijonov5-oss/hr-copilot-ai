import { Global, Module } from '@nestjs/common';
import { OwnedVacancyService } from './owned-vacancy.service';

/**
 * Global, like Tenant/Membership: the owned-vacancy policy is cross-cutting
 * (vacancies, candidates, applications, evidence-map, search, processing,
 * chat) and depends only on the global PrismaModule, so making every feature
 * module import it explicitly would add noise without adding safety.
 */
@Global()
@Module({
  providers: [OwnedVacancyService],
  exports: [OwnedVacancyService],
})
export class VacancyAccessModule {}
