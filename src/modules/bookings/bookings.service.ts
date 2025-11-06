import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { BookingStatus } from '@prisma/client';
import { FindAllDto } from '../../common/global/find-all.dto';
import { RabbitMQProducerService } from '../../messaging/rabbitmq/rabbitmq.producer.service';
import { RedisService } from '../../messaging/redis/redis.service';
import { KafkaProducerService } from 'src/messaging/kafka/kafka.producer.service';
import { ExternalService } from '../../common/external/external.service';
// import { BookingCreatedDto } from '../../messaging/rabbitmq/dto/booking-created.dto.service';
// import { BookingUpdatedDto } from '../../messaging/rabbitmq/dto/booking-updated.dto';
// import { BookingCanceledDto } from '../../messaging/rabbitmq/dto/booking-canceled.dto';

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQService: RabbitMQProducerService,
    private readonly redisService: RedisService,
    private readonly kafkaProducerService: KafkaProducerService,
    private readonly externalService: ExternalService,
    ) {}

  async create(userId: string, dto: CreateBookingDto) {
    try {
      const booking = await this.prisma.booking.create({
        data: {
          userId,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          details: {
            create: dto.details.map((d) => ({
              roomId: d.roomId,
              price: d.price,
              note: d.note,
              time: d.time,
            })),
          },
        },
        include: { details: true },
      });

      // Cache booking
      // await this.redisService.set(`booking:${booking.id}`, booking, 3600);
      // this.logger.debug(`Cached booking:${booking.id}`);

      // Send RabbitMQ event for booking.created
      const bookingCreatedEvent: any = {
        bookingId: booking.id,
        userId: booking.userId,
        status: booking.status,
        startDate: booking.startDate,
        endDate: booking.endDate,
        details: booking.details.map((d) => ({
          roomId: d.roomId,
          price: d.price,
          time: d.time,
        })),
      };
      
      try {
        await this.rabbitMQService.publishBookingCreated(bookingCreatedEvent);
        this.logger.log(`Published booking.created event: ${booking.id}`);
      } catch (error) {
        this.logger.warn(`Failed to publish booking.created event: ${error.message}`);
        // Continue execution even if RabbitMQ fails
      }

      await this.kafkaProducerService.emitBookingCreatedEvent(bookingCreatedEvent);
      this.logger.log(`Published booking.created event to Kafka: ${booking.id}`);

      return booking;
    } catch (error) {
      this.logger.error(`Failed to create booking: ${error.message}`, error.stack);
      throw error;
    }
  }

  async findAll(query: FindAllDto, token?: string) {
    const {
      page = 1,
      limit = 10,
      search = '',
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    if (pageNumber < 1 || limitNumber < 1) {
      throw new Error('Page and limit must be greater than 0');
    }

    const take = limitNumber;
    const skip = (pageNumber - 1) * take;

    const searchUpCase = search.charAt(0).toUpperCase() + search.slice(1);
    const where = search
      ? {
          OR: [
            { userId: { contains: searchUpCase } },
            { details: { some: { roomId: { contains: searchUpCase } } } },
          ],
        }
      : {};
    const orderBy = { [sortBy]: sortOrder };

    const [bookings, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        orderBy,
        skip,
        take,
        include: { details: true },
      }),
      this.prisma.booking.count({ where }),
    ]);

    // Enrich bookings với user và room data
    const enrichedBookings = await this.enrichBookingsWithExternalData(
      bookings,
      token,
    );

    return {
      data: enrichedBookings,
      meta: {
        total,
        pageNumber,
        limitNumber,
        totalPages: Math.ceil(total / limitNumber),
      },
    };
  }

  /**
   * Enrich bookings với user và room data từ external services
   */
  private async enrichBookingsWithExternalData(
    bookings: any[],
    token?: string,
  ): Promise<any[]> {
    if (bookings.length === 0) {
      return bookings;
    }

    // Collect tất cả userId và roomId
    const userIds: string[] = [];
    const roomIds: string[] = [];

    bookings.forEach((booking) => {
      if (booking.userId && !userIds.includes(booking.userId)) {
        userIds.push(booking.userId);
      }
      booking.details?.forEach((detail: any) => {
        if (detail.roomId && !roomIds.includes(detail.roomId)) {
          roomIds.push(detail.roomId);
        }
      });
    });

    // Fetch users và rooms parallel (tối ưu performance)
    const [usersMap, roomsMap] = await Promise.all([
      this.externalService.getUsersByIds(userIds, token),
      this.externalService.getRoomsByIds(roomIds, token),
    ]);

    // Map data vào bookings
    return bookings.map((booking) => ({
      ...booking,
      user: usersMap.get(booking.userId) || null,
      details: booking.details?.map((detail: any) => ({
        ...detail,
        room: roomsMap.get(detail.roomId) || null,
      })) || [],
    }));
  }

  async findOne(id: string, token?: string) {
    // Check cache first
    const cachedBooking = await this.redisService.get(`booking:${id}`);
    if (cachedBooking) {
      this.logger.debug(`Cache hit for booking:${id}`);
      // Still enrich với external data vì cache có thể không có user/room
      const enriched = await this.enrichBookingsWithExternalData(
        [cachedBooking],
        token,
      );
      return enriched[0];
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: { details: true },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Enrich với external data
    const enriched = await this.enrichBookingsWithExternalData([booking], token);
    const enrichedBooking = enriched[0];

    // Cache booking (không cache external data để tránh stale data)
    await this.redisService.set(`booking:${id}`, booking, 3600);
    this.logger.debug(`Cached booking:${id}`);

    return enrichedBooking;
  }

  async update(id: string, dto: UpdateBookingDto) {
    try {
      const booking = await this.prisma.booking.update({
        where: { id },
        data: {
          status: dto.status,
          details: {
            update: dto.details?.map((d) => ({
              where: { id: d.roomId },
              data: {
                price: d.price,
                time: d.time,
              },
            })),
          },
        },
        include: { details: true },
      });

      // Update cache
      await this.redisService.set(`booking:${id}`, booking, 3600);
      this.logger.debug(`Updated cache for booking:${id}`);

      // Send RabbitMQ event for booking.updated
      const bookingUpdatedEvent: any = {
        bookingId: booking.id,
        status: booking.status,
        details: booking.details.map((d) => ({
          roomId: d.roomId,
          price: d.price,
        })),
      };
      await this.rabbitMQService.publishBookingCreated(bookingUpdatedEvent);
      this.logger.log(`Published booking.updated event: ${booking.id}`);

      return booking;
    } catch (error) {
      this.logger.error(`Failed to update booking ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async cancel(id: string, status: BookingStatus) {
    try {
      // Validate status - chỉ cho phép CONFIRMED hoặc CANCELED
      if (status !== BookingStatus.CONFIRMED && status !== BookingStatus.CANCELED) {
        throw new Error(`Invalid status: ${status}. Only CONFIRMED or CANCELED are allowed.`);
      }

      const booking = await this.prisma.booking.update({
        where: { id },
        data: { status }, // Sử dụng parameter status thay vì hardcode
        include: { details: true },
      });

      // Update cache
      await this.redisService.set(`booking:${id}`, booking, 3600);
      this.logger.debug(`Updated cache for booking:${id}`);

      // Send Kafka event for booking status change
      const bookingStatusEvent: any = {
        bookingId: booking.id,
        userId: booking.userId,
        status: booking.status,
        details: booking.details.map((d) => d.roomId),
      };

      // Send RabbitMQ events (wrapped in try-catch để không crash nếu RabbitMQ fail)
      try {
        if (status === BookingStatus.CANCELED) {
          // Send RabbitMQ event for booking.canceled
          await this.rabbitMQService.publishMessage('booking.canceled', bookingStatusEvent);
          this.logger.log(`Published booking.canceled event: ${booking.id}`);

          // Send RabbitMQ payment cancel request
          const totalAmount = booking.details.reduce((sum, detail) => sum + detail.price, 0);
          await this.rabbitMQService.publishMessage('payment.cancel', {
            bookingId: booking.id,
            userId: booking.userId,
            amount: totalAmount,
            eventType: 'payment.cancel',
            metadata: {
              reason: 'Booking cancelled by user',
              cancelledAt: new Date().toISOString(),
            },
          });
          this.logger.log(`Published payment.cancel event for booking: ${booking.id}`);
        } else if (status === BookingStatus.CONFIRMED) {
          // Send event for booking confirmed
          await this.rabbitMQService.publishMessage('booking.confirmed', bookingStatusEvent);
          this.logger.log(`Published booking.confirmed event: ${booking.id}`);
        }
      } catch (error) {
        // Log warning nhưng không throw - booking đã được update thành công
        this.logger.warn(
          `Failed to publish RabbitMQ events for booking ${booking.id}: ${error.message || error}`,
        );
      }

      // Send Kafka event (wrapped in try-catch)
      try {
        await this.kafkaProducerService.emitBookingCreatedEvent(bookingStatusEvent);
      } catch (error) {
        this.logger.warn(
          `Failed to publish Kafka event for booking ${booking.id}: ${error.message || error}`,
        );
      }

      return booking;
    } catch (error) {
      this.logger.error(
        `Failed to update booking status ${id} to ${status}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async getBookingByUserId(userId: string) {
    const bookings = await this.prisma.booking.findMany({
      where: { userId },
      include: { details: true },
    });
    return bookings;
  }

  async getBookingByRoomId(roomId: string) {
    const bookings = await this.prisma.booking.findMany({
      where: { details: { some: { roomId } } },
      include: { details: true },
    });
    return bookings;
  }

  async delete(id: string) {
    try {
      const booking = await this.prisma.booking.delete({
        where: { id },
      });

      // Remove from cache
      await this.redisService.del(`booking:${id}`);
      this.logger.debug(`Removed booking:${id} from cache`);

      return booking;
    } catch (error) {
      this.logger.error(`Failed to delete booking ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }
}