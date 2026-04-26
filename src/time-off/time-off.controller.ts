import { Controller, Post, Get, Body, Param, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { TimeOffService } from './time-off.service';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto';
import { SyncBalanceDto } from './dto/sync-balance.dto';
import { GetBalanceQueryDto } from './dto/get-balance.dto';
import { RejectTimeOffRequestDto } from './dto/reject-time-off-request.dto';

@Controller('time-off')
export class TimeOffController {
  constructor(private readonly timeOffService: TimeOffService) {}

  @Post('requests')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async createRequest(@Body() dto: CreateTimeOffRequestDto) {
    return this.timeOffService.createRequest(dto);
  }

  @Post('requests/:id/approve')
  async approveRequest(@Param('id') id: string) {
    return this.timeOffService.approveRequest(id);
  }

  @Post('requests/:id/reject')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async rejectRequest(@Param('id') id: string, @Body() dto: RejectTimeOffRequestDto) {
    return this.timeOffService.rejectRequest(id, dto.rejectionReason);
  }

  @Get('requests')
  async getRequests(@Query('employeeId') employeeId?: string, @Query('locationId') locationId?: string) {
    console.log('Getting requests with filters:', { employeeId, locationId });
    return this.timeOffService.getRequests({ employeeId, locationId });
  }

  @Get('balances')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async getBalance(@Query() query: GetBalanceQueryDto) {
    return this.timeOffService.getBalance(query.employeeId, query.locationId, query.refresh ?? false);
  }

  @Post('balances/sync')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async syncBalances(@Body() dto: SyncBalanceDto) {
    return this.timeOffService.syncBalances(dto.balances);
  }
}
