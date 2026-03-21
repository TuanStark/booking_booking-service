import { Module, forwardRef } from '@nestjs/common';
import { BookingService } from './bookings.service';
import { BookingController } from './bookings.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { RabbitMQModule } from '../../messaging/rabbitmq/rabbitmq.module';
import { RedisModule } from '../../messaging/redis/redis.module';
import { ExternalModule } from '../../common/external/external.module';
import { BookingsCronService } from './bookings.cron';

@Module({
  imports: [
    forwardRef(() => RabbitMQModule), // ✅ Fix circular dependency
    PrismaModule,
    RedisModule,
    forwardRef(() => RedisModule), // ✅ Fix circular dependency\
    forwardRef(() => RabbitMQModule), // ✅ Fix circular dependency
    ExternalModule,
  ],
  controllers: [BookingController],
  providers: [BookingService, BookingsCronService],
  exports: [BookingService],
})
export class BookingsModule {}
