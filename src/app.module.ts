import { Module } from '@nestjs/common';
import { BookingsModule } from './modules/bookings/bookings.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { RabbitMQModule } from './messaging/rabbitmq/rabbitmq.module';
import { KafkaModule } from './messaging/kafka/kafka.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    BookingsModule,
    RabbitMQModule,
    KafkaModule,
  ],
  controllers: [],
  providers: [PrismaService],
})
export class AppModule {}
