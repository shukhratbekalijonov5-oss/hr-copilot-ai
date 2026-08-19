import { IsEnum } from 'class-validator';
import { ApplicationStatus } from '../../generated/prisma/enums';

/**
 * The only way an application changes stage. Always driven by a human request;
 * nothing in the backend or the queue may call this on its own.
 */
export class UpdateApplicationStatusDto {
  @IsEnum(ApplicationStatus)
  status!: ApplicationStatus;
}
