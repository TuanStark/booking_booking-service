import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RabbitMQProducerService } from './rabbitmq.producer.service';
import { RabbitMQConsumerController } from './rabbitmq.consumer.controller';
import { BookingsModule } from '../../modules/bookings/bookings.module';

@Module({
  imports: [ConfigModule, forwardRef(() => BookingsModule)],
  controllers: [RabbitMQConsumerController],
  providers: [RabbitMQProducerService],
  exports: [RabbitMQProducerService],
})
export class RabbitMQModule {}
