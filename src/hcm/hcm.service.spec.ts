import { BadRequestException } from '@nestjs/common';
import { HcmService } from './hcm.service';

describe('HcmService', () => {
  let service: HcmService;

  beforeEach(() => {
    service = new HcmService();
  });

  it('returns the default balance when none exists', () => {
    const result = service.getBalance('emp1', 'locA');
    expect(result.availableDays).toBe(10);
  });

  it('reduces the balance when time off is filed', () => {
    const first = service.fileTimeOff('emp1', 'locA', 3);
    expect(first.availableDays).toBe(7);

    const second = service.getBalance('emp1', 'locA');
    expect(second.availableDays).toBe(7);
  });

  it('reduces the balance from a cached HCM balance on subsequent filings', () => {
    service.fileTimeOff('emp1', 'locA', 3);
    const second = service.fileTimeOff('emp1', 'locA', 2);

    expect(second.availableDays).toBe(5);
    expect(service.getBalance('emp1', 'locA').availableDays).toBe(5);
  });

  it('throws BadRequestException when HCM balance is insufficient', () => {
    expect(() => service.fileTimeOff('emp1', 'locA', 20)).toThrow(BadRequestException);
  });

  it('synchronizes balances and returns the payload', () => {
    const payload = [
      { employeeId: 'emp2', locationId: 'locB', availableDays: 5 },
    ];

    const result = service.batchSync(payload);

    expect(result).toEqual(payload);
    expect(service.getBalance('emp2', 'locB').availableDays).toBe(5);
  });
});
