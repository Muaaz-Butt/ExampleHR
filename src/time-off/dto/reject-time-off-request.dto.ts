import { IsString, IsOptional, MinLength } from 'class-validator';

export class RejectTimeOffRequestDto {
  @IsOptional()
  @IsString()
  @MinLength(5)
  rejectionReason?: string;
}
