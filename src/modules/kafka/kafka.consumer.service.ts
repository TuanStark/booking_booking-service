import { Injectable, OnModuleInit } from '@nestjs/common';
import { Kafka, EachMessagePayload } from 'kafkajs';
import { KafkaTopics } from './kafka-topics.enum';
import { ConfigService } from '@nestjs/config';
import { BookingService } from '../bookings/bookings.service';
import { BookingStatus } from '@prisma/client';

@Injectable()
export class KafkaConsumerService implements OnModuleInit {
  private readonly kafka: Kafka;
  private readonly consumer;

  constructor(
    private readonly configService: ConfigService,
    private readonly bookingService: BookingService,
  ) {
    this.kafka = new Kafka({
      clientId: this.configService.get<string>('KAFKA_CLIENT_ID') || 'booking-service',
      brokers: this.configService.get<string>('KAFKA_BROKER')?.split(',') || ['localhost:9092'],
    });

    this.consumer = this.kafka.consumer({ groupId: this.configService.get<string>('KAFKA_GROUP_ID') || 'booking-group' });
  }

  async onModuleInit() {
    try {
      await this.consumer.connect();

      //Sub chỉ các topic thực sự cần thiết
      // Payment events - QUAN TRỌNG NHẤT để update booking status
      await this.consumer.subscribe({ topic: KafkaTopics.PAYMENT_SUCCESS });
      await this.consumer.subscribe({ topic: KafkaTopics.PAYMENT_FAILED });
      await this.consumer.subscribe({ topic: KafkaTopics.PAYMENT_REFUNDED });
      
      // Room events - CHỈ CẦN room.deleted để cancel future bookings
      await this.consumer.subscribe({ topic: KafkaTopics.ROOM_DELETED });

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
          // Payment events - Quan trọng nhất
          case KafkaTopics.PAYMENT_SUCCESS:
            await this.handlePaymentSuccess(data);
            break;
          case KafkaTopics.PAYMENT_FAILED:
            await this.handlePaymentFailed(data);
            break;
          case KafkaTopics.PAYMENT_REFUNDED:
            await this.handlePaymentRefunded(data);
            break;
            
          // Room events - Chỉ cần room.deleted
          case KafkaTopics.ROOM_DELETED:
            await this.handleRoomDeleted(data);
            break;
            
          default:
            console.warn(`Unhandled topic: ${topic}`);
        }
      },
    });
  }

  // Logic xử lý khi nhận event
  
  // Payment events - Quan trọng nhất
  private async handlePaymentSuccess(data: any) {
    console.log('📩 [Kafka] Payment success event received:', data);
    
    try {
      const { bookingId, paymentId, amount, transactionId } = data;
      
      if (!bookingId) {
        console.warn('⚠️ Missing bookingId in payment success event');
        return;
      }

      // Update booking status từ PENDING → CONFIRMED
      const booking = await this.bookingService.findOne(bookingId);
      if (!booking) {
        console.warn(`⚠️ Booking ${bookingId} not found`);
        return;
      }

      if (booking.status === BookingStatus.PENDING) {
        await this.bookingService.update(bookingId, { 
          status: BookingStatus.CONFIRMED 
        });
        console.log(`✅ Booking ${bookingId} confirmed after payment success`);
      } else {
        console.log(`ℹ️ Booking ${bookingId} already ${booking.status}, skipping`);
      }
      
    } catch (error) {
      console.error('❌ Error handling payment success event:', error.message);
    }
  }

  private async handlePaymentFailed(data: any) {
    console.log('📩 [Kafka] Payment failed event received:', data);
    
    try {
      const { bookingId, paymentId, reason } = data;
      
      if (!bookingId) {
        console.warn('⚠️ Missing bookingId in payment failed event');
        return;
      }

      // Update booking status từ PENDING → CANCELED
      const booking = await this.bookingService.findOne(bookingId);
      if (!booking) {
        console.warn(`⚠️ Booking ${bookingId} not found`);
        return;
      }

      if (booking.status === BookingStatus.PENDING) {
        await this.bookingService.update(bookingId, { 
          status: BookingStatus.CANCELED 
        });
        console.log(`✅ Booking ${bookingId} canceled after payment failed`);
      } else {
        console.log(`ℹ️ Booking ${bookingId} already ${booking.status}, skipping`);
      }
      
    } catch (error) {
      console.error('❌ Error handling payment failed event:', error.message);
    }
  }

  private async handlePaymentRefunded(data: any) {
    console.log('📩 [Kafka] Payment refunded event received:', data);
    
    try {
      const { bookingId, paymentId, refundAmount, reason } = data;
      
      if (!bookingId) {
        console.warn('⚠️ Missing bookingId in payment refunded event');
        return;
      }

      // Update booking status từ CONFIRMED → CANCELED (refunded)
      const booking = await this.bookingService.findOne(bookingId);
      if (!booking) {
        console.warn(`⚠️ Booking ${bookingId} not found`);
        return;
      }

      if (booking.status === BookingStatus.CONFIRMED) {
        await this.bookingService.update(bookingId, { 
          status: BookingStatus.CANCELED 
        });
        console.log(`✅ Booking ${bookingId} canceled after payment refunded`);
      } else {
        console.log(`ℹ️ Booking ${bookingId} status is ${booking.status}, cannot refund`);
      }
      
    } catch (error) {
      console.error('❌ Error handling payment refunded event:', error.message);
    }
  }

  // Room events - Chỉ cần room.deleted
  private async handleRoomDeleted(data: any) {
    console.log('📩 [Kafka] Room deleted event received:', data);
    
    try {
      const { roomId, buildingId } = data;
      
      if (!roomId) {
        console.warn('⚠️ Missing roomId in room deleted event');
        return;
      }

      // Cancel all future bookings for this room
      const futureBookings = await this.bookingService.getBookingByRoomId(roomId);
      
      for (const booking of futureBookings) {
        // Chỉ cancel bookings trong tương lai
        if (new Date(booking.startDate) > new Date()) {
          await this.bookingService.update(booking.id, { 
            status: BookingStatus.CANCELED 
          });
          console.log(`✅ Canceled future booking ${booking.id} for deleted room ${roomId}`);
        }
      }
      
    } catch (error) {
      console.error('❌ Error handling room deleted event:', error.message);
    }
  }
}
