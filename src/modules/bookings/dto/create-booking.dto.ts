import {
  IsUUID,
  IsDateString,
  IsArray,
  ValidateNested,
  IsNumber,
  IsOptional,
  IsString,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

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
  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsString()
  @IsIn(['VIETQR', 'VNPAY'], {
    message: 'paymentMethod must be either VIETQR or VNPAY',
  })
  paymentMethod: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingDetailItem)
  details: BookingDetailItem[];
}
