import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class QueryConversationsDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  vacancyId?: string;
}
