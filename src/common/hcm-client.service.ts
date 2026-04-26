import { Injectable, Logger, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError, isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';

export interface HcmBalanceResponse {
  employeeId: string;
  locationId: string;
  availableDays: number;
}

export class HcmUnavailableException extends ServiceUnavailableException {
  constructor(message = 'HCM is unavailable.') {
    super(message);
  }
}

export class HcmInsufficientBalanceException extends BadRequestException {
  constructor(message = 'Insufficient HCM balance.') {
    super(message);
  }
}

@Injectable()
export class HcmClientService {
  private readonly logger = new Logger(HcmClientService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>('HCM_API_BASE_URL', 'http://localhost:3000');
  }

  async fetchBalance(employeeId: string, locationId: string): Promise<HcmBalanceResponse> {
    const url = `${this.baseUrl}/hcm/balance`;
    this.logger.debug(`Fetching balance from HCM: ${url}`);
    try {
      const response = await firstValueFrom(
        this.httpService.get(url, { params: { employeeId, locationId } }),
      );
      return this.validateBalanceResponse(response.data);
    } catch (error) {
      this.handleHcmError(error);
    }
  }

  async fileTimeOff(employeeId: string, locationId: string, days: number): Promise<HcmBalanceResponse> {
    const url = `${this.baseUrl}/hcm/timeoff`;
    this.logger.debug(`Filing time off with HCM: ${url}`);
    try {
      const response = await firstValueFrom(
        this.httpService.post(url, { employeeId, locationId, days }),
      );
      const result = this.validateBalanceResponse(response.data);
      if (result.availableDays < 0) {
        throw new HcmInsufficientBalanceException('HCM returned an invalid remaining balance.');
      }
      return result;
    } catch (error) {
      this.handleHcmError(error);
    }
  }

  async pushBatch(balances: Array<{ employeeId: string; locationId: string; availableDays: number }>) {
    const url = `${this.baseUrl}/hcm/batch-sync`;
    this.logger.debug(`Pushing batch to HCM: ${url}`);
    try {
      const response = await firstValueFrom(this.httpService.post(url, { balances }));
      return response.data;
    } catch (error) {
      this.handleHcmError(error);
    }
  }

  private validateBalanceResponse(data: unknown): HcmBalanceResponse {
    if (
      !data ||
      typeof data !== 'object' ||
      typeof (data as any).employeeId !== 'string' ||
      typeof (data as any).locationId !== 'string' ||
      typeof (data as any).availableDays !== 'number' ||
      !Number.isFinite((data as any).availableDays)
    ) {
      throw new HcmUnavailableException('Invalid HCM response payload.');
    }
    return data as HcmBalanceResponse;
  }

  private handleHcmError(error: unknown): never {
    if (isAxiosError(error)) {
      const status = error.response?.status;
      const message =
        error.response?.data?.message || error.message || 'Unexpected HCM error.';

      if (status === 400 || status === 409) {
        throw new HcmInsufficientBalanceException(message);
      }
      throw new HcmUnavailableException(message);
    }

    throw new HcmUnavailableException('Unexpected HCM error.');
  }
}
