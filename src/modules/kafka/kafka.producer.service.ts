import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { KafkaTopics } from './kafka-topics.enum';

@Injectable()
export class KafkaProducerService implements OnModuleInit {
  constructor(
    @Inject('KAFKA_SERVICE') private readonly kafkaClient: ClientKafka,
  ) {}

  async onModuleInit() {
    try {
      Object.values(KafkaTopics).forEach((topic) =>
        this.kafkaClient.subscribeToResponseOf(topic),
      );
      await this.kafkaClient.connect();
    } catch (error) {
      console.warn('⚠️ Kafka not available, skipping producer setup:', error.message);
    }
  }

  async emitBookingCreatedEvent(payload: any) {
    await this.kafkaClient.emit(KafkaTopics.BOOKING_CREATED, payload);
  }

  async emitBookingCanceledEvent(payload: any) {
    await this.kafkaClient.emit(KafkaTopics.BOOKING_CANCELED, payload);
  }
}
