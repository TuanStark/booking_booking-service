import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class RabbitMQProducerService {
  private readonly logger = new Logger(RabbitMQProducerService.name);
  private readonly exchange: string;
  private readonly routingKey: string;

  constructor(
    @Inject('RABBITMQ_CLIENT') private readonly client: ClientProxy,
    private readonly configService: ConfigService,
  ) {
    this.exchange = this.configService.get<string>('RABBITMQ_EXCHANGE') || 'booking.payments';
    this.routingKey = this.configService.get<string>('RABBITMQ_ROUTING_KEY') || 'booking.created';
  }

  async publishBookingCreated(data: any): Promise<void> {
    try {
      if (!this.client) {
        this.logger.error('RabbitMQ client is not available');
        throw new Error('RabbitMQ client is not available');
      }
      
      await this.client.connect();
      await lastValueFrom(this.client.emit(this.routingKey, data));
      this.logger.log(`Published booking.created event: ${JSON.stringify(data)}`);
    } catch (error) {
      this.logger.error(`Failed to publish booking.created: ${error.message}`, error.stack);
      throw error;
    }
  }

  async publishMessage(pattern: string, data: any): Promise<void> {
    try {
      if (!this.client) {
        this.logger.error('RabbitMQ client is not available');
        throw new Error('RabbitMQ client is not available');
      }
      
      await this.client.connect();
      await lastValueFrom(this.client.emit(pattern, data));
      this.logger.log(`Message published to pattern: ${pattern}, data: ${JSON.stringify(data)}`);
    } catch (error: any) {
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      this.logger.error(`Failed to publish message to pattern ${pattern}: ${errorMessage}`, error?.stack);
      // Không throw error để tránh crash toàn bộ flow
      // Chỉ log warning và tiếp tục
      this.logger.warn(`Continuing execution despite RabbitMQ publish failure`);
    }
  }

  async onModuleDestroy() {
    await this.client.close();
    this.logger.log('RabbitMQ client closed');
  }
}