import { forwardRef, Module } from '@nestjs/common';
import { KafkaProducerService } from './kafka.producer.service';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { BookingsModule } from 'src/modules/bookings/bookings.module';

@Module({
  imports: [
    forwardRef(() => BookingsModule),
    ClientsModule.registerAsync([
      {
        name: 'KAFKA_SERVICE',
        useFactory: (configService: ConfigService) => ({
          transport: Transport.KAFKA,
          options: {
            client: {
              clientId: configService.get<string>('KAFKA_CLIENT_ID') || 'booking-service',
              brokers: configService.get<string>('KAFKA_BROKER')?.split(',') || ['localhost:9092'],
            },
            consumer: {
              groupId: 'booking-consumer',
            },
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [KafkaProducerService],
  exports: [KafkaProducerService],
})
export class KafkaModule {}
