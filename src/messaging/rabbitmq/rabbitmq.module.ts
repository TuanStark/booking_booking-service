import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { RabbitMQProducerService } from './rabbitmq.producer.service';
import { RabbitMQConsumerController } from './rabbitmq.consumer.controller';
import { BookingsModule } from '../../modules/bookings/bookings.module';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => BookingsModule),
    ClientsModule.registerAsync([
      {
        name: 'RABBITMQ_CLIENT',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [
              configService.get<string>('RABBITMQ_URL') ||
              'amqp://localhost:5672',
            ],
            queue:
              configService.get<string>('RABBITMQ_QUEUE') || 'booking.payments',
            queueOptions: { durable: true },
            // Lỗi do RPC reply queue của RabbitMQ bắt buộc auto-ack, nhưng bạn lại cấu hình/ack thủ công → RabbitMQ đóng channel (406).
            //noAck: true, (ignore cái này để fix lỗi)
            // lưu ý: reply message không cần ack
            prefetchCount: 1,
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [RabbitMQConsumerController],
  providers: [RabbitMQProducerService],
  exports: [RabbitMQProducerService],
})
export class RabbitMQModule { }

