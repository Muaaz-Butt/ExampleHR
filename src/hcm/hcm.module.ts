import { Module } from '@nestjs/common';
import { HcmController } from './hcm.controller';
import { HcmService } from './hcm.service';

@Module({
  controllers: [HcmController],
  providers: [HcmService],
})
export class HcmModule {}
