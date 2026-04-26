import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsNumber, Min, IsArray, ArrayMinSize, ValidateNested } from 'class-validator';

export class HcmBalanceQueryDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;
}

export class HcmFileTimeOffDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsNumber()
  @Min(1)
  days!: number;
}

class HcmBatchSyncItemDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsNumber()
  @Min(0)
  availableDays!: number;
}

export class HcmBatchSyncDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => HcmBatchSyncItemDto)
  balances!: HcmBatchSyncItemDto[];
}
