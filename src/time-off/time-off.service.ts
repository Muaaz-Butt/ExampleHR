import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { TimeOffRequest, RequestStatus } from './entities/time-off-request.entity';
import { Balance } from './entities/balance.entity';
import { HcmClientService } from '../common/hcm-client.service';

@Injectable()
export class TimeOffService {
  private readonly logger = new Logger(TimeOffService.name);

  constructor(
    @InjectRepository(TimeOffRequest)
    private readonly requestRepository: Repository<TimeOffRequest>,
    @InjectRepository(Balance)
    private readonly balanceRepository: Repository<Balance>,
    private readonly hcmClient: HcmClientService,
    private readonly dataSource: DataSource,
  ) {}

  async getBalance(employeeId: string, locationId: string, refresh = false): Promise<Balance> {
    const key = { employeeId, locationId };
    let balance = await this.balanceRepository.findOneBy(key);
    if (!balance || refresh) {
      const remote = await this.hcmClient.fetchBalance(employeeId, locationId);
      const updated = balance ? { ...balance, availableDays: remote.availableDays, source: 'HCM' } : {
        ...key,
        availableDays: remote.availableDays,
        source: 'HCM',
      };
      balance = await this.balanceRepository.save(updated);
    }
    return balance;
  }

  async createRequest(payload: {
    employeeId: string;
    locationId: string;
    days: number;
    startDate: string;
    endDate: string;
  }): Promise<TimeOffRequest> {
    const existingRequest = await this.requestRepository.findOneBy({
      employeeId: payload.employeeId,
      locationId: payload.locationId,
      startDate: payload.startDate,
      endDate: payload.endDate,
    });

    if (existingRequest) {
      throw new BadRequestException('A request for the same dates already exists.');
    }

    const localBalance = await this.balanceRepository.findOneBy({
      employeeId: payload.employeeId,
      locationId: payload.locationId,
    });

    if (localBalance && localBalance.availableDays < payload.days) {
      throw new BadRequestException('Insufficient local balance to place request.');
    }

    const balance = await this.getBalance(payload.employeeId, payload.locationId, true);
    if (balance.availableDays < payload.days) {
      throw new BadRequestException('Insufficient HCM balance to place request.');
    }
    console.log('Creating time-off request with payload:', balance);

    return this.requestRepository.save({
      ...payload,
      status: RequestStatus.PENDING,
    });
  }

  async approveRequest(requestId: string): Promise<TimeOffRequest> {
    return this.dataSource.transaction(async (manager) => {
      const request = await manager.findOne(TimeOffRequest, {
        where: { id: requestId },
      });

      if (!request) {
        throw new NotFoundException('Time-off request not found.');
      }
      if (request.status !== RequestStatus.PENDING) {
        throw new BadRequestException('Only pending requests can be approved.');
      }

      const balance = await manager.findOne(Balance, {
        where: { employeeId: request.employeeId, locationId: request.locationId },
      });

      if (balance && balance.availableDays < request.days) {
        throw new BadRequestException('Insufficient local balance for approval.');
      }

      const remote = await this.hcmClient.fileTimeOff(request.employeeId, request.locationId, request.days);
      if (remote.availableDays < 0) {
        throw new BadRequestException('HCM returned invalid remaining balance after approval.');
      }

      const updatedBalance = balance
        ? { ...balance, availableDays: remote.availableDays, source: 'HCM' }
        : manager.create(Balance, {
            employeeId: request.employeeId,
            locationId: request.locationId,
            availableDays: remote.availableDays,
            source: 'HCM',
          });

      await manager.save(Balance, updatedBalance);
      request.status = RequestStatus.APPROVED;
      return manager.save(TimeOffRequest, request);
    });
  }

  async rejectRequest(requestId: string, rejectionReason?: string): Promise<TimeOffRequest> {
    return this.dataSource.transaction(async (manager) => {
      const request = await manager.findOne(TimeOffRequest, {
        where: { id: requestId }
      });

      if (!request) {
        throw new NotFoundException('Time-off request not found.');
      }
      if (request.status !== RequestStatus.PENDING) {
        throw new BadRequestException('Only pending requests can be rejected.');
      }

      request.status = RequestStatus.REJECTED;
      request.rejectionReason = rejectionReason;
      return manager.save(TimeOffRequest, request);
    });
  }

  async syncBalances(balances: Array<{ employeeId: string; locationId: string; availableDays: number }>) {
    const payload = balances.map((item) => ({
      employeeId: item.employeeId,
      locationId: item.locationId,
      availableDays: item.availableDays,
      source: 'HCM',
    }));

    await this.balanceRepository.upsert(payload, ['employeeId', 'locationId']);
    return this.balanceRepository.find({
      where: payload.map((item) => ({ employeeId: item.employeeId, locationId: item.locationId })),
    });
  }

  async getRequests(filters: { employeeId?: string; locationId?: string }) {
    return this.requestRepository.find({
      where: filters,
      order: { requestedAt: 'DESC' },
    });
  }
}
