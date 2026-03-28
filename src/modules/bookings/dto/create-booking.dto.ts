import {
  IsUUID,
  IsDateString,
  IsArray,
  ValidateNested,
  IsNumber,
  IsOptional,
  IsString,
  IsIn,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

class BookingDetailItem {
  @IsUUID()
  roomId: string;

  @IsNumber()
  @IsOptional()
  price?: number;

  /** Số chỗ đặt (sinh viên = 1; đặt cặp có thể = 2). Backend chặn theo capacity phòng. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  occupancyUnits?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateBookingDto {
  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsString()
  @IsIn(['VIETQR', 'VNPAY', 'MOMO', 'PAYOS'], {
    message: 'paymentMethod must be either VIETQR, VNPAY, MOMO or PAYOS',
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
