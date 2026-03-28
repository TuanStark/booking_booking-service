import {
  IsDateString,
  IsOptional,
  IsString,
  IsIn,
  Min,
} from 'class-validator';

/**
 * DTO for renewing an existing lease.
 * The new endDate must extend the lease by at least 3 months from the current endDate.
 */
export class RenewBookingDto {
  @IsDateString()
  newEndDate: string;

  @IsString()
  @IsIn(['VIETQR', 'VNPAY', 'MOMO', 'PAYOS'], {
    message: 'paymentMethod must be either VIETQR, VNPAY, MOMO or PAYOS',
  })
  paymentMethod: string;

  @IsString()
  @IsOptional()
  note?: string;
}
