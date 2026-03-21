import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { BookingService } from './bookings.service';
import { BookingStatus } from './dto/enum';

@Injectable()
export class BookingsCronService {
  private readonly logger = new Logger(BookingsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingService: BookingService,
  ) {}

  /**
   * Run every minute to check for expired pending bookings.
   * Bookings that remain PENDING for more than 15 minutes are automatically cancelled,
   * which triggers the Saga to release room capacity.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpiredBookings() {
    this.logger.debug('Running expired bookings cleanup job...');

    // Time window: 15 minutes ago
    const expirationThreshold = new Date(Date.now() - 15 * 60 * 1000);

    try {
      // Find bookings that have been pending for more than 15 minutes
      const expiredBookings = await this.prisma.booking.findMany({
        where: {
          status: BookingStatus.PENDING,
          createdAt: {
            lt: expirationThreshold,
          },
        },
        select: { id: true },
      });

      if (expiredBookings.length === 0) {
        return;
      }

      this.logger.log(
        `Found ${expiredBookings.length} expired bookings to cancel.`,
      );

      // Cancel each booking sequentially to ensure events are dispatched reliably
      for (const booking of expiredBookings) {
        try {
          // This will change status to CANCELED and emit 'booking.canceled' RabbitMQ event
          await this.bookingService.cancel(booking.id, BookingStatus.CANCELED);
          this.logger.log(
            `Automatically cancelled expired booking: ${booking.id}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to cancel expired booking ${booking.id}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Error finding expired bookings: ${error.message}`);
    }
  }
}
