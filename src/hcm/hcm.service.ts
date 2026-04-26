import { Injectable, BadRequestException } from '@nestjs/common';

export interface HcmBalanceResponse {
  employeeId: string;
  locationId: string;
  availableDays: number;
}

@Injectable()
export class HcmService {
  private readonly balances = new Map<string, number>();
  private readonly defaultBalance = 10;

  getBalance(employeeId: string, locationId: string): HcmBalanceResponse {
    const key = this.makeKey(employeeId, locationId);
    const availableDays = this.balances.has(key)
      ? this.balances.get(key)!
      : this.defaultBalance;
    return { employeeId, locationId, availableDays };
  }

  fileTimeOff(employeeId: string, locationId: string, days: number): HcmBalanceResponse {
    const key = this.makeKey(employeeId, locationId);
    const current = this.balances.has(key) ? this.balances.get(key)! : this.defaultBalance;
    const next = current - days;
    if (next < 0) {
      throw new BadRequestException('Insufficient HCM balance.');
    }
    this.balances.set(key, next);
    return { employeeId, locationId, availableDays: next };
  }

  batchSync(balances: Array<{ employeeId: string; locationId: string; availableDays: number }>) {
    balances.forEach((item) => {
      const key = this.makeKey(item.employeeId, item.locationId);
      this.balances.set(key, item.availableDays);
    });
    return balances;
  }

  private makeKey(employeeId: string, locationId: string) {
    return `${employeeId}:${locationId}`;
  }
}
