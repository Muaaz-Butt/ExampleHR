import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeOffController } from './time-off.controller';
import { TimeOffService } from './time-off.service';
import { CommonModule } from '../common/common.module';
import { TimeOffRequest } from './entities/time-off-request.entity';
import { Balance } from './entities/balance.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TimeOffRequest, Balance]), CommonModule],
  controllers: [TimeOffController],
  providers: [TimeOffService],
})
export class TimeOffModule {}
