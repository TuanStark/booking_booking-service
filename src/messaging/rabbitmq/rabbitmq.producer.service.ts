import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class RabbitMQProducerService implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQProducerService.name);
  private readonly routingKeyCreated: string;
  private readonly routingKeyUpdated: string;
  private readonly routingKeyCanceled: string;
  private readonly routingKeyConfirmed: string;

  constructor(
    @Inject('RABBITMQ_CLIENT') private readonly client: ClientProxy,
    private readonly configService: ConfigService,
  ) {
    this.routingKeyCreated = 'booking.created';
    this.routingKeyUpdated = 'booking.updated';
    this.routingKeyCanceled = 'booking.canceled';
    this.routingKeyConfirmed = 'booking.confirmed';
  }

  async publishMessage(pattern: string, data: any): Promise<void> {
    try {
      if (!this.client) {
        this.logger.error('RabbitMQ client is not available');
        throw new Error('RabbitMQ client is not available');
      }

      await this.client.connect();
      await lastValueFrom(this.client.emit(pattern, data));
      this.logger.log(
        `Message published to pattern: ${pattern}, data: ${JSON.stringify(data)}`,
      );
    } catch (error: any) {
      const errorMessage =
        error?.message || error?.toString() || 'Unknown error';
      this.logger.error(
        `Failed to publish message to pattern ${pattern}: ${errorMessage}`,
        error?.stack,
      );
      // We don't always want to throw here to avoid crashing the whole flow if messaging fails
      // But for critical events, we might want to know.
    }
  }

  async publishBookingCreated(data: any): Promise<void> {
    await this.publishMessage(this.routingKeyCreated, data);
  }

  async publishBookingUpdated(data: any): Promise<void> {
    await this.publishMessage(this.routingKeyUpdated, data);
  }

  async publishBookingCanceled(data: any): Promise<void> {
    await this.publishMessage(this.routingKeyCanceled, data);
  }

  async publishBookingConfirmed(data: any): Promise<void> {
    await this.publishMessage(this.routingKeyConfirmed, data);
  }

  async publishPaymentCancel(data: any): Promise<void> {
    await this.publishMessage('payment.cancel', data);
  }

  async onModuleDestroy() {
    await this.client.close();
    this.logger.log('RabbitMQ client closed');
  }
}
