import { Module } from '@nestjs/common';
import { BookingsModule } from './modules/bookings/bookings.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { KafkaService } from './kafka/kafka.service';
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    BookingsModule,
  ],
  controllers: [],
  providers: [PrismaService, KafkaService],
  exports: [KafkaService],
})
export class AppModule {}
