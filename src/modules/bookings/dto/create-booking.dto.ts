import { IsUUID, IsDateString, IsArray, ValidateNested, IsNumber, IsOptional, IsString, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { BookingStatus } from '@prisma/client';

class BookingDetailItem {
  @IsUUID()
  roomId: string;

  @IsNumber()
  price: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsNumber()
  @Type(() => Number)
  time: number;
}

export class CreateBookingDto {

  @IsUUID()
  @IsOptional()
  id: string;

  @IsEnum(BookingStatus)
  status: BookingStatus;

  @IsUUID()
  @IsOptional()
  userId: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingDetailItem)
  details: BookingDetailItem[];
}
