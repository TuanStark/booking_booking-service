import { Injectable, OnModuleInit } from '@nestjs/common';
import { Kafka, EachMessagePayload } from 'kafkajs';
import { KafkaTopics } from './kafka-topics.enum';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class KafkaConsumerService implements OnModuleInit {
  private readonly kafka: Kafka;
  private readonly consumer;

  constructor(private readonly configService: ConfigService) {
    this.kafka = new Kafka({
      clientId: this.configService.get<string>('KAFKA_CLIENT_ID') || 'booking-service',
      brokers: this.configService.get<string>('KAFKA_BROKER')?.split(',') || ['localhost:9092'],
    });

    this.consumer = this.kafka.consumer({ groupId: this.configService.get<string>('KAFKA_GROUP_ID') || 'booking-group' });
  }

  async onModuleInit() {
    try {
      await this.consumer.connect();

      //Sub tất cả các topic mà service này quan tâm
      // Booking events
      await this.consumer.subscribe({ topic: KafkaTopics.BOOKING_CREATED });
      await this.consumer.subscribe({ topic: KafkaTopics.BOOKING_CANCELED });
      
      // Payment events
      await this.consumer.subscribe({ topic: KafkaTopics.PAYMENT_SUCCESS });
      await this.consumer.subscribe({ topic: KafkaTopics.PAYMENT_FAILED });
      await this.consumer.subscribe({ topic: KafkaTopics.PAYMENT_REFUNDED });
      
      // Room events
      await this.consumer.subscribe({ topic: KafkaTopics.ROOM_CREATED });
      await this.consumer.subscribe({ topic: KafkaTopics.ROOM_UPDATED });
      await this.consumer.subscribe({ topic: KafkaTopics.ROOM_DELETED });
      
      // User events
      await this.consumer.subscribe({ topic: KafkaTopics.USER_REGISTERED });
      await this.consumer.subscribe({ topic: KafkaTopics.USER_UPDATED });
      
      // Notification events
      await this.consumer.subscribe({ topic: KafkaTopics.NOTIFICATION_SENT });
      
      // Review events
      await this.consumer.subscribe({ topic: KafkaTopics.REVIEW_CREATED });
      await this.consumer.subscribe({ topic: KafkaTopics.REVIEW_UPDATED });

      await this.run();
    } catch (error) {
      console.warn('⚠️ Kafka not available, skipping consumer setup:', error.message);
    }
  }

  private async run() {
    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
        const value = message.value?.toString();
        if (!value) return;

        const data = JSON.parse(value);
        switch (topic) {
          // Booking events
          case KafkaTopics.BOOKING_CREATED:
            await this.handleBookingCreated(data);
            break;
          case KafkaTopics.BOOKING_CANCELED:
            await this.handleBookingCanceled(data);
            break;
            
          // Payment events
          case KafkaTopics.PAYMENT_SUCCESS:
            await this.handlePaymentSuccess(data);
            break;
          case KafkaTopics.PAYMENT_FAILED:
            await this.handlePaymentFailed(data);
            break;
          case KafkaTopics.PAYMENT_REFUNDED:
            await this.handlePaymentRefunded(data);
            break;
            
          // Room events
          case KafkaTopics.ROOM_CREATED:
            await this.handleRoomCreated(data);
            break;
          case KafkaTopics.ROOM_UPDATED:
            await this.handleRoomUpdated(data);
            break;
          case KafkaTopics.ROOM_DELETED:
            await this.handleRoomDeleted(data);
            break;
            
          // User events
          case KafkaTopics.USER_REGISTERED:
            await this.handleUserRegistered(data);
            break;
          case KafkaTopics.USER_UPDATED:
            await this.handleUserUpdated(data);
            break;
            
          // Notification events
          case KafkaTopics.NOTIFICATION_SENT:
            await this.handleNotificationSent(data);
            break;
            
          // Review events
          case KafkaTopics.REVIEW_CREATED:
            await this.handleReviewCreated(data);
            break;
          case KafkaTopics.REVIEW_UPDATED:
            await this.handleReviewUpdated(data);
            break;
            
          default:
            console.warn(`Unhandled topic: ${topic}`);
        }
      },
    });
  }

  //  Logic xử lý khi nhận event
  
  // Booking events
  private async handleBookingCreated(data: any) {
    console.log('📩 [Kafka] Booking created event received:', data);
    //Ví dụ: update phòng -> set room.status = 'OCCUPIED'
  }

  private async handleBookingCanceled(data: any) {
    console.log('📩 [Kafka] Booking canceled event received:', data);
    // Ví dụ: update phòng -> set room.status = 'AVAILABLE'
  }

  // Payment events
  private async handlePaymentSuccess(data: any) {
    console.log('📩 [Kafka] Payment success event received:', data);
    // Ví dụ: confirm booking, update booking status to 'CONFIRMED'
  }

  private async handlePaymentFailed(data: any) {
    console.log('📩 [Kafka] Payment failed event received:', data);
    // Ví dụ: cancel booking, update booking status to 'CANCELLED'
  }

  private async handlePaymentRefunded(data: any) {
    console.log('📩 [Kafka] Payment refunded event received:', data);
    // Ví dụ: update booking status to 'REFUNDED', release room
  }

  // Room events
  private async handleRoomCreated(data: any) {
    console.log('📩 [Kafka] Room created event received:', data);
    // Ví dụ: sync room data to local cache
  }

  private async handleRoomUpdated(data: any) {
    console.log('📩 [Kafka] Room updated event received:', data);
    // Ví dụ: update room info in booking records
  }

  private async handleRoomDeleted(data: any) {
    console.log('📩 [Kafka] Room deleted event received:', data);
    // Ví dụ: cancel all future bookings for this room
  }

  // User events
  private async handleUserRegistered(data: any) {
    console.log('📩 [Kafka] User registered event received:', data);
    // Ví dụ: create user profile in booking service
  }

  private async handleUserUpdated(data: any) {
    console.log('📩 [Kafka] User updated event received:', data);
    // Ví dụ: sync user info in booking records
  }

  // Notification events
  private async handleNotificationSent(data: any) {
    console.log('📩 [Kafka] Notification sent event received:', data);
    // Ví dụ: update notification status in booking
  }

  // Review events
  private async handleReviewCreated(data: any) {
    console.log('📩 [Kafka] Review created event received:', data);
    // Ví dụ: link review to booking, update booking with review info
  }

  private async handleReviewUpdated(data: any) {
    console.log('📩 [Kafka] Review updated event received:', data);
    // Ví dụ: update review info in booking
  }
}
