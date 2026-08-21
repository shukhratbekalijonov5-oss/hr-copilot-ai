import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { NotificationType } from '../../generated/prisma/enums';

export class QueryNotificationsDto extends PaginationQueryDto {
  /** `?unreadOnly=true` — everything else (or absence) means all. */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;
}
