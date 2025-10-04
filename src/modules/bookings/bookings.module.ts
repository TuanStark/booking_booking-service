import { Module } from '@nestjs/common';
import { BookingService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { KafkaService } from 'src/kafka/kafka.service';

@Module({
  controllers: [BookingsController],
  providers: [BookingService, KafkaService, PrismaService],
})
export class BookingsModule {}
