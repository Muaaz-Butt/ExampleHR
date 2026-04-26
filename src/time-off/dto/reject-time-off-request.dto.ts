import { IsString, IsOptional, MinLength } from 'class-validator';

export class RejectTimeOffRequestDto {
  @IsOptional()
  @IsString()
  @MinLength(10, {
    message: 'rejectionReason must be at least 10 characters if provided',
  })
  rejectionReason?: string;
}