import {
  IsString,
  IsNumber,
  Min,
  IsDateString,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

function parseIsoDate(value: string): Date | null {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

@ValidatorConstraint({ name: 'DaysWithinDateRange', async: false })
class DaysWithinDateRangeConstraint implements ValidatorConstraintInterface {
  validate(days: number, args: ValidationArguments) {
    const obj = args.object as CreateTimeOffRequestDto;
    if (
      typeof days !== 'number' ||
      typeof obj.startDate !== 'string' ||
      typeof obj.endDate !== 'string'
    ) {
      return false;
    }

    const start = parseIsoDate(obj.startDate);
    const end = parseIsoDate(obj.endDate);
    if (!start || !end) {
      return false;
    }

    // endDate must not be before startDate
    if (end.getTime() < start.getTime()) {
      return false;
    }

    // days must be positive and must not exceed the inclusive calendar span
    // (allows half-days and partial-day values like 0.5)
    const calendarDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24) + 1;
    return days > 0 && days <= calendarDays;
  }

  defaultMessage(_args: ValidationArguments) {
    return 'days must be a positive number that does not exceed the span between startDate and endDate';
  }
}

export function DaysWithinDateRange(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: DaysWithinDateRangeConstraint,
    });
  };
}

export class CreateTimeOffRequestDto {
  @IsString()
  employeeId!: string;

  @IsString()
  locationId!: string;

  @IsNumber()
  @Min(0.5)
  @DaysWithinDateRange({
    message: 'days must be a positive number that does not exceed the span between startDate and endDate',
  })
  days!: number;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}