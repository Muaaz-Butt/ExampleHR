import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CreateTimeOffRequestDto,
  DaysWithinDateRange,
} from './create-time-off-request.dto';

describe('CreateTimeOffRequestDto validation', () => {
  it('accepts a valid request with correct day count', async () => {
    const dto = plainToInstance(CreateTimeOffRequestDto, {
      employeeId: 'emp1',
      locationId: 'locA',
      days: 2,
      startDate: '2026-05-01',
      endDate: '2026-05-02',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a request when days exceeds the date range', async () => {
    const dto = plainToInstance(CreateTimeOffRequestDto, {
      employeeId: 'emp1',
      locationId: 'locA',
      days: 4,
      startDate: '2026-05-01',
      endDate: '2026-05-02',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toBeDefined();
  });

  it('rejects a request when endDate is before startDate', async () => {
    const dto = plainToInstance(CreateTimeOffRequestDto, {
      employeeId: 'emp1',
      locationId: 'locA',
      days: 1,
      startDate: '2026-05-05',
      endDate: '2026-05-04',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a request with invalid actual dates that are still ISO strings', async () => {
    const dto = plainToInstance(CreateTimeOffRequestDto, {
      employeeId: 'emp1',
      locationId: 'locA',
      days: 1,
      startDate: '2026-02-30',
      endDate: '2026-02-30',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a request with invalid date strings', async () => {
    const dto = plainToInstance(CreateTimeOffRequestDto, {
      employeeId: 'emp1',
      locationId: 'locA',
      days: 1,
      startDate: 'not-a-date',
      endDate: 'also-not-a-date',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a request when days or dates are not the expected types', async () => {
    const dto = plainToInstance(CreateTimeOffRequestDto, {
      employeeId: 'emp1',
      locationId: 'locA',
      days: '2',
      startDate: 20260501,
      endDate: 20260502,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('exposes the DaysWithinDateRange decorator factory', () => {
    const decorator = DaysWithinDateRange({ message: 'custom message' });
    expect(typeof decorator).toBe('function');
  });

  it('uses the constraint default message when no custom message is provided', async () => {
    class TestDto {
      @DaysWithinDateRange()
      days!: number;

      startDate!: string;
      endDate!: string;
    }

    const dto = new TestDto();
    dto.days = 3 as any;
    dto.startDate = '2026-02-30';
    dto.endDate = '2026-02-30';

    const errors = await validate(dto);
    expect(
      errors.some((error: any) =>
        error.constraints &&
        Object.values(error.constraints).some(
          (message: unknown) =>
            message ===
            'days must be a positive number that does not exceed the span between startDate and endDate',
        ),
      ),
    ).toBe(true);
  });
});
