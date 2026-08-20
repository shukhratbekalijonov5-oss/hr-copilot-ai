import { Global, Module } from '@nestjs/common';
import { AccountTypeService } from './account-type.service';

@Global()
@Module({
  providers: [AccountTypeService],
  exports: [AccountTypeService],
})
export class IdentityModule {}
