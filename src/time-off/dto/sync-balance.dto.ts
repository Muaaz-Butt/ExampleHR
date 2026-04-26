import { IsArray, ValidateNested, IsString, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class BalanceItemDto {
  @IsString()
  employeeId!: string;

  @IsString()
  locationId!: string;

  @IsNumber()
  @Min(0)
  availableDays!: number;
}

export class SyncBalanceDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BalanceItemDto)
  balances!: BalanceItemDto[];
}
