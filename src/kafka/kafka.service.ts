import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Kafka, Producer, Consumer } from 'kafkajs';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private kafka: Kafka;
  private producer: Producer;
  private consumer: Consumer;
  private readonly logger = new Logger(KafkaService.name);

  constructor() {
    this.kafka = new Kafka({
      clientId: process.env.KAFKA_CLIENT_ID || 'building-service',
      brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
    });

    this.producer = this.kafka.producer();
  }

  async onModuleInit() {
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  async onModuleDestroy() {
    await this.producer.disconnect();
    if (this.consumer) {
      await this.consumer.disconnect();
    }
  }

  /** Publish event */
  async publish(topic: string, message: any) {
    await this.producer.send({
      topic,
      messages: [
        {
          key: message.id || null,
          value: JSON.stringify(message),
        },
      ],
    });
    this.logger.log(`Published to ${topic}: ${JSON.stringify(message)}`);
  }

  /** Subscribe to a topic */
  async subscribe(
    groupId: string,
    topic: string,
    callback: (message: any) => Promise<void> | void,
  ) {
    this.consumer = this.kafka.consumer({ groupId });

    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: false });

    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const rawValue = message.value?.toString();
        this.logger.log(`Received from ${topic}: ${rawValue}`);
        try {
          const payload = rawValue ? JSON.parse(rawValue) : {};
          await callback(payload);
        } catch (err) {
          this.logger.error(`Error processing message: ${err}`);
        }
      },
    });
  }
}
