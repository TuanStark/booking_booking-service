import { Module } from '@nestjs/common';
import { BookingService } from './bookings.service';
import { BookingController } from './bookings.controller';
import { KafkaModule } from '../kafka/kafka.module';

@Module({
  imports: [KafkaModule],
  controllers: [BookingController],
  providers: [BookingService],
})
export class BookingModule {}
