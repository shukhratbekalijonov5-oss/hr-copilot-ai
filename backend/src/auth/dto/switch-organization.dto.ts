import { IsUUID } from 'class-validator';

/**
 * The one endpoint where a client legitimately names an organizationId — and
 * only to ASK for it: the backend verifies a live membership before issuing a
 * token that points at it, and every later request re-verifies again.
 */
export class SwitchOrganizationDto {
  @IsUUID()
  organizationId!: string;
}
