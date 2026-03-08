import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqp-connection-manager';
import { ChannelWrapper } from 'amqp-connection-manager';
import { ConfirmChannel } from 'amqplib';

@Injectable()
export class RabbitMQProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQProducerService.name);
  private connection: amqp.AmqpConnectionManager;
  private channelWrapper: ChannelWrapper;

  private readonly exchange: string;
  private readonly queue: string;

  constructor(private readonly configService: ConfigService) {
    this.exchange = this.configService.get<string>('RABBITMQ_EXCHANGE') || 'booking_topic_exchange';
    this.queue = this.configService.get<string>('RABBITMQ_QUEUE') || 'booking_worker_queue';
  }

  async onModuleInit() {
    const url = this.configService.get<string>('RABBITMQ_URL') || 'amqp://localhost:5672';
    this.connection = amqp.connect([url]);

    this.connection.on('connect', () => this.logger.log('Connected to RabbitMQ!'));
    this.connection.on('disconnect', err => this.logger.error('Disconnected from RabbitMQ.', err));

    this.channelWrapper = this.connection.createChannel({
      json: true,
      setup: async (channel: ConfirmChannel) => {
        // 1. Assert Topic Exchange
        await channel.assertExchange(this.exchange, 'topic', { durable: true });

        // 2. Assert Queue
        await channel.assertQueue(this.queue, { durable: true });

        // 3. Bind Queue to Exchange with routing keys this service needs to listen to
        // Booking Service needs to listen to payment events
        await channel.bindQueue(this.queue, this.exchange, 'payment.*');

        this.logger.log(`RabbitMQ Topology Setup: Exchange=${this.exchange}, Queue=${this.queue}`);
      },
    });
  }

  async publishMessage(routingKey: string, data: any): Promise<void> {
    try {
      if (!this.channelWrapper) {
        throw new Error('RabbitMQ channel is not available');
      }

      // NestJS native RMQ consumers expect strict { pattern, data } format
      const payload = {
        pattern: routingKey,
        data: data,
      };

      await this.channelWrapper.publish(this.exchange, routingKey, payload, {
        persistent: true,
      } as any);

      this.logger.log(`Message published to exchange ${this.exchange} with routingKey: ${routingKey}`);
    } catch (error: any) {
      this.logger.error(`Failed to publish message to routingKey ${routingKey}: ${error.message}`, error.stack);
    }
  }

  async publishBookingCreated(data: any): Promise<void> {
    await this.publishMessage('booking.created', data);
  }

  async publishBookingUpdated(data: any): Promise<void> {
    await this.publishMessage('booking.updated', data);
  }

  async publishBookingCanceled(data: any): Promise<void> {
    await this.publishMessage('booking.canceled', data);
  }

  async publishBookingConfirmed(data: any): Promise<void> {
    await this.publishMessage('booking.confirmed', data);
  }

  async publishPaymentCancel(data: any): Promise<void> {
    await this.publishMessage('payment.cancel', data);
  }

  async onModuleDestroy() {
    if (this.channelWrapper) {
      await this.channelWrapper.close();
    }
    if (this.connection) {
      await this.connection.close();
    }
    this.logger.log('RabbitMQ connection closed');
  }
}
