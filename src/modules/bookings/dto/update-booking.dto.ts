import { PartialType } from '@nestjs/mapped-types';
import { CreateBookingDto } from './create-booking.dto';
import { IsArray, IsEnum, IsNumber, IsUUID, ValidateNested } from 'class-validator';
import { BookingStatus } from '@prisma/client';
import { Type } from 'class-transformer';

class BookingDetailItem {
  @IsUUID()
  roomId: string;

  @IsNumber()
  price: number;

  @IsNumber()
  @Type(() => Number)
  time: number;
}

export class UpdateBookingDto extends PartialType(CreateBookingDto) {
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingDetailItem)
  details?: BookingDetailItem[];
}
