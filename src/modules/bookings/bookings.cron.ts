import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { BookingService } from './bookings.service';
import { BookingStatus } from './dto/enum';
import { RabbitMQProducerService } from '../../messaging/rabbitmq/rabbitmq.producer.service';

/** Days before lease end to trigger re-listing */
const RELIST_BEFORE_DAYS = 30;

/** Days of renewal priority window (current tenant gets priority) */
const RENEWAL_PRIORITY_DAYS = 7;

@Injectable()
export class BookingsCronService {
  private readonly logger = new Logger(BookingsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingService: BookingService,
    private readonly rabbitMQService: RabbitMQProducerService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // CRON 1: Cancel expired PENDING bookings (payment timeout — 15 minutes)
  // Runs: every minute
  // ═══════════════════════════════════════════════════════════════════════════

  @Cron(CronExpression.EVERY_MINUTE)
  async handlePendingTimeout() {
    this.logger.debug('Running pending bookings cleanup job...');

    const expirationThreshold = new Date(Date.now() - 15 * 60 * 1000);

    try {
      const expiredBookings = await this.prisma.booking.findMany({
        where: {
          status: BookingStatus.PENDING,
          createdAt: {
            lt: expirationThreshold,
          },
        },
        select: { id: true },
      });

      if (expiredBookings.length === 0) return;

      this.logger.log(
        `Found ${expiredBookings.length} expired pending bookings to cancel.`,
      );

      for (const booking of expiredBookings) {
        try {
          await this.bookingService.updateStatus(
            booking.id,
            BookingStatus.CANCELED,
          );
          this.logger.log(
            `Automatically cancelled expired pending booking: ${booking.id}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to cancel expired pending booking ${booking.id}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Error finding expired pending bookings: ${error.message}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRON 2: Activate CONFIRMED bookings whose startDate has passed
  // Runs: every day at 00:01
  // ═══════════════════════════════════════════════════════════════════════════

  @Cron('1 0 * * *')
  async activateConfirmedBookings() {
    this.logger.debug('Running booking activation job...');
    const now = new Date();

    try {
      const readyBookings = await this.prisma.booking.findMany({
        where: {
          status: BookingStatus.CONFIRMED,
          startDate: { lte: now },
          paymentStatus: 'SUCCESS',
        },
        include: { details: true },
      });

      if (readyBookings.length === 0) return;

      this.logger.log(
        `Found ${readyBookings.length} confirmed bookings to activate.`,
      );

      for (const booking of readyBookings) {
        try {
          await this.prisma.booking.update({
            where: { id: booking.id },
            data: { status: BookingStatus.ACTIVE },
          });

          this.publishEventSafe('booking.activated', {
            bookingId: booking.id,
            userId: booking.userId,
            startDate: booking.startDate,
            endDate: booking.endDate,
            details: booking.details.map((d) => ({
              roomId: d.roomId,
              price: d.price,
            })),
          });

          this.logger.log(`Activated booking: ${booking.id}`);
        } catch (error) {
          this.logger.error(
            `Failed to activate booking ${booking.id}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Error in activation job: ${error.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRON 3: Detect ACTIVE bookings expiring within 30 days → EXPIRING_SOON
  //         Sets renewal deadline, publishes re-list and notification events
  // Runs: every day at 06:00
  // ═══════════════════════════════════════════════════════════════════════════

  @Cron('0 6 * * *')
  async handleExpiringBookings() {
    this.logger.debug('Running expiring bookings detection job...');

    const threshold = new Date();
    threshold.setDate(threshold.getDate() + RELIST_BEFORE_DAYS);

    try {
      const expiringBookings = await this.prisma.booking.findMany({
        where: {
          status: BookingStatus.ACTIVE,
          endDate: { lte: threshold },
          isRelisted: false,
        },
        include: { details: true },
      });

      if (expiringBookings.length === 0) return;

      this.logger.log(
        `Found ${expiringBookings.length} bookings expiring within ${RELIST_BEFORE_DAYS} days.`,
      );

      for (const booking of expiringBookings) {
        try {
          // Calculate renewal deadline: endDate - (RELIST_BEFORE_DAYS - RENEWAL_PRIORITY_DAYS) days
          const renewalDeadline = new Date(booking.endDate);
          renewalDeadline.setDate(
            renewalDeadline.getDate() -
              (RELIST_BEFORE_DAYS - RENEWAL_PRIORITY_DAYS),
          );

          await this.prisma.booking.update({
            where: { id: booking.id },
            data: {
              status: BookingStatus.EXPIRING_SOON,
              isRelisted: true,
              renewalDeadline,
            },
          });

          // Notify current tenant about expiring lease
          this.publishEventSafe('notification.lease_expiring', {
            bookingId: booking.id,
            userId: booking.userId,
            endDate: booking.endDate,
            renewalDeadline,
            daysRemaining: Math.ceil(
              (booking.endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
            ),
          });

          // Signal room-service that room will be available for pre-booking
          this.publishEventSafe('booking.expiring_soon', {
            bookingId: booking.id,
            userId: booking.userId,
            endDate: booking.endDate,
            renewalDeadline,
            details: booking.details.map((d) => ({
              roomId: d.roomId,
              price: d.price,
            })),
          });

          this.logger.log(
            `Booking ${booking.id} marked EXPIRING_SOON, renewal deadline: ${renewalDeadline.toISOString()}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to process expiring booking ${booking.id}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Error in expiring bookings job: ${error.message}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRON 4: Complete EXPIRED bookings (endDate has passed)
  // Runs: every day at 00:00
  // ═══════════════════════════════════════════════════════════════════════════

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleExpiredBookings() {
    this.logger.debug('Running expired bookings completion job...');
    const now = new Date();

    try {
      const expiredBookings = await this.prisma.booking.findMany({
        where: {
          status: {
            in: [BookingStatus.ACTIVE, BookingStatus.EXPIRING_SOON],
          },
          endDate: { lt: now },
        },
        include: { details: true },
      });

      if (expiredBookings.length === 0) return;

      this.logger.log(
        `Found ${expiredBookings.length} expired bookings to complete.`,
      );

      for (const booking of expiredBookings) {
        try {
          await this.prisma.booking.update({
            where: { id: booking.id },
            data: { status: BookingStatus.COMPLETED },
          });

          // Notify room-service to release capacity
          this.publishEventSafe('booking.completed', {
            bookingId: booking.id,
            userId: booking.userId,
            details: booking.details.map((d) => d.roomId),
          });

          this.logger.log(`Completed expired booking: ${booking.id}`);
        } catch (error) {
          this.logger.error(
            `Failed to complete expired booking ${booking.id}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Error in expired bookings completion job: ${error.message}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRON 5: Activate QUEUED pre-bookings when their startDate arrives
  // Runs: every day at 00:05 (after expired job)
  // ═══════════════════════════════════════════════════════════════════════════

  @Cron('5 0 * * *')
  async activateQueuedBookings() {
    this.logger.debug('Running queued bookings activation job...');
    const now = new Date();

    try {
      const queuedBookings = await this.prisma.booking.findMany({
        where: {
          status: BookingStatus.QUEUED,
          startDate: { lte: now },
        },
        include: { details: true },
      });

      if (queuedBookings.length === 0) return;

      this.logger.log(
        `Found ${queuedBookings.length} queued pre-bookings to activate.`,
      );

      for (const booking of queuedBookings) {
        try {
          // Transition QUEUED → CONFIRMED (payment flow will begin)
          await this.prisma.booking.update({
            where: { id: booking.id },
            data: { status: BookingStatus.CONFIRMED },
          });

          this.publishEventSafe('booking.queued_activated', {
            bookingId: booking.id,
            userId: booking.userId,
            startDate: booking.startDate,
            endDate: booking.endDate,
            details: booking.details.map((d) => ({
              roomId: d.roomId,
              price: d.price,
            })),
          });

          this.logger.log(`Activated queued pre-booking: ${booking.id}`);
        } catch (error) {
          this.logger.error(
            `Failed to activate queued booking ${booking.id}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Error in queued bookings activation job: ${error.message}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE — Event helper
  // ═══════════════════════════════════════════════════════════════════════════

  private publishEventSafe(routingKey: string, data: any): void {
    this.rabbitMQService
      .publishMessage(routingKey, data)
      .then(() => this.logger.log(`Published ${routingKey} event`))
      .catch((error) =>
        this.logger.warn(
          `Failed to publish ${routingKey} event: ${error.message}`,
        ),
      );
  }
}
