import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** New accounts send name + password; existing accounts send their current password. */
export class AcceptInviteDto {
  @IsString()
  @IsNotEmpty()
  password: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  mfaCode?: string;
}
