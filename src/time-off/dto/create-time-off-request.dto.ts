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

@ValidatorConstraint({ name: 'DaysMatchDateRange', async: false })
class DaysMatchDateRangeConstraint implements ValidatorConstraintInterface {
  validate(days: number, args: ValidationArguments) {
    const obj = args.object as CreateTimeOffRequestDto;
    if (typeof days !== 'number' || typeof obj.startDate !== 'string' || typeof obj.endDate !== 'string') {
      return false;
    }

    const start = new Date(obj.startDate);
    const end = new Date(obj.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return false;
    }

    const diffMs = end.getTime() - start.getTime();
    if (diffMs < 0) {
      return false;
    }

    const diffDays = diffMs / (1000 * 60 * 60 * 24) + 1;
    return diffDays === days;
  }

  defaultMessage(args: ValidationArguments) {
    return 'days must equal the inclusive number of days between startDate and endDate';
  }
}

function DaysMatchDateRange(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: DaysMatchDateRangeConstraint,
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
  @DaysMatchDateRange({
    message: 'days must match the span between startDate and endDate',
  })
  days!: number;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}
