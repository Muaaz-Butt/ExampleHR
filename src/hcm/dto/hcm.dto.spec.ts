import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { HcmBalanceQueryDto, HcmFileTimeOffDto, HcmBatchSyncDto } from './hcm.dto';

describe('HCM DTO validation', () => {
  it('validates a correct HcmBalanceQueryDto', async () => {
    const dto = plainToInstance(HcmBalanceQueryDto, { employeeId: 'emp1', locationId: 'locA' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects an HcmBalanceQueryDto without employeeId', async () => {
    const dto = plainToInstance(HcmBalanceQueryDto, { locationId: 'locA' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'employeeId')).toBe(true);
  });

  it('validates a correct HcmFileTimeOffDto', async () => {
    const dto = plainToInstance(HcmFileTimeOffDto, { employeeId: 'emp1', locationId: 'locA', days: 1 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects an HcmFileTimeOffDto with days below the minimum', async () => {
    const dto = plainToInstance(HcmFileTimeOffDto, { employeeId: 'emp1', locationId: 'locA', days: 0 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'days')).toBe(true);
  });

  it('validates HcmBatchSyncDto with nested balances and class-transformer type conversion', async () => {
    const dto = plainToInstance(HcmBatchSyncDto, {
      balances: [{ employeeId: 'emp1', locationId: 'locA', availableDays: 5 }],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects HcmBatchSyncDto when nested balance item is invalid', async () => {
    const dto = plainToInstance(HcmBatchSyncDto, {
      balances: [{ employeeId: 'emp1', locationId: 'locA', availableDays: -1 }],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);

    const findProperty = (items: any[], name: string): boolean =>
      items.some((item) =>
        item.property === name || (item.children && findProperty(item.children, name)),
      );

    expect(findProperty(errors, 'availableDays')).toBe(true);
  });
});
