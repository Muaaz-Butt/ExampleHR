import { Controller, Get, Post, Query, Body, UsePipes, ValidationPipe } from '@nestjs/common';
import { HcmService } from './hcm.service';
import { HcmBalanceQueryDto, HcmFileTimeOffDto, HcmBatchSyncDto } from './dto/hcm.dto';

@Controller('hcm')
export class HcmController {
  constructor(private readonly hcmService: HcmService) {}

  @Get('balance')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  getBalance(@Query() query: HcmBalanceQueryDto) {
    return this.hcmService.getBalance(query.employeeId, query.locationId);
  }

  @Post('timeoff')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  fileTimeOff(@Body() body: HcmFileTimeOffDto) {
    return this.hcmService.fileTimeOff(body.employeeId, body.locationId, body.days);
  }

  @Post('batch-sync')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  batchSync(@Body() body: HcmBatchSyncDto) {
    return this.hcmService.batchSync(body.balances);
  }
}
