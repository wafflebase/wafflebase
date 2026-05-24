import { IsString, Length } from 'class-validator';

export class CliExchangeDto {
  @IsString()
  @Length(1, 200)
  code: string;
}
