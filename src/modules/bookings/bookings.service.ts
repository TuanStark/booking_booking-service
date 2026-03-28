import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { RenewBookingDto } from './dto/renew-booking.dto';
import { BookingStatus, PaymentStatus } from './dto/enum';
import { FindAllDto } from '../../common/global/find-all.dto';
import { RabbitMQProducerService } from '../../messaging/rabbitmq/rabbitmq.producer.service';
import { RedisService } from '../../messaging/redis/redis.service';
import { ExternalService } from '../../common/external/external.service';
import { ConfigService } from '@nestjs/config';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum rental duration in months */
const MIN_RENTAL_MONTHS = 3;

/** Days before lease end to trigger re-listing and notifications */
const RELIST_BEFORE_DAYS = 30;

/** Days of priority renewal window for current tenant (30 - 7 = opens at day 23 before end) */
const RENEWAL_PRIORITY_DAYS = 7;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);
  private readonly paymentServiceUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQService: RabbitMQProducerService,
    private readonly redisService: RedisService,
    private readonly externalService: ExternalService,
    private readonly configService: ConfigService,
  ) {
    this.paymentServiceUrl =
      this.configService.get<string>('PAYMENT_SERVICE_URL') ||
      'http://localhost:3006';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE — With 3-month minimum, overlap detection, and pre-booking support
  // ═══════════════════════════════════════════════════════════════════════════

  async create(userId: string, dto: CreateBookingDto, token?: string) {
    try {
      if (!dto.details || dto.details.length === 0) {
        throw new BadRequestException('Booking details are required');
      }

      const startDate = new Date(dto.startDate);
      const endDate = new Date(dto.endDate);

      // --- Validate date range ---
      if (endDate <= startDate) {
        throw new BadRequestException('endDate must be after startDate');
      }

      // --- Validate minimum 3-month rental ---
      const durationMonths = this.calculateMonthsDifference(startDate, endDate);
      if (durationMonths < MIN_RENTAL_MONTHS) {
        throw new BadRequestException(
          `Minimum rental duration is ${MIN_RENTAL_MONTHS} months. Requested: ${durationMonths} months.`,
        );
      }

      // --- Fetch real room prices (skip cache to avoid stale data) ---
      const roomIds = dto.details.map((d) => d.roomId);
      const roomsMap = await this.externalService.getRoomsByIds(
        roomIds,
        token,
        { useCache: false },
      );

      // --- Check overlap for each room ---
      for (const detail of dto.details) {
        const realRoom = roomsMap.get(detail.roomId);
        if (!realRoom) {
          throw new BadRequestException(
            `Room with ID ${detail.roomId} not found`,
          );
        }

        await this.validateNoOverlap(detail.roomId, startDate, endDate);
      }

      // --- Determine if this is a pre-booking (room has EXPIRING_SOON lease) ---
      const isPreBooking = await this.isPreBookingEligible(roomIds, startDate);

      // --- Build booking details ---
      const detailCreates = dto.details.map((detail) => {
        const realRoom = roomsMap.get(detail.roomId)!;
        const price = Number(realRoom.price);
        return {
          roomId: detail.roomId,
          price,
          note: detail.note,
        };
      });

      // --- Calculate total (price × durationMonths for deposit) ---
      let totalAmount = 0;
      for (const d of detailCreates) {
        totalAmount += d.price * durationMonths;
      }

      if (totalAmount <= 0) {
        throw new BadRequestException('Total amount must be greater than 0');
      }

      // --- Create booking record ---
      const bookingStatus = isPreBooking
        ? BookingStatus.QUEUED
        : BookingStatus.PENDING;

      const booking = await this.prisma.booking.create({
        data: {
          userId,
          startDate,
          endDate,
          durationMonths,
          status: bookingStatus,
          details: {
            create: detailCreates,
          },
        },
        include: { details: true },
      });

      this.logger.log(
        `Booking created: ${booking.id} (status=${bookingStatus}, duration=${durationMonths}mo)`,
      );

      // --- Publish booking.created event ---
      this.publishEventSafe('booking.created', {
        bookingId: booking.id,
        userId: booking.userId,
        status: booking.status,
        startDate: booking.startDate,
        endDate: booking.endDate,
        durationMonths: booking.durationMonths,
        isPreBooking,
        details: booking.details.map((d) => ({
          roomId: d.roomId,
          price: d.price,
        })),
      });

      // --- For QUEUED bookings, skip payment now (payment starts when activated) ---
      if (isPreBooking) {
        return {
          ...booking,
          payment: null,
          message: 'Pre-booking created. Payment will be processed when the room becomes available.',
        };
      }

      // --- Create payment session for normal bookings ---
      let payment: any = null;
      try {
        payment = await this.createPaymentSession({
          bookingId: booking.id,
          userId,
          amount: totalAmount,
          paymentMethod: dto.paymentMethod,
        });
      } catch (paymentError) {
        await this.safeDeleteBooking(booking.id);
        throw paymentError;
      }

      if (payment?.id) {
        await this.prisma.booking.update({
          where: { id: booking.id },
          data: {
            paymentId: payment.id,
            paymentStatus: PaymentStatus.PENDING,
          },
        });

        booking.paymentId = payment.id;
        booking.paymentStatus = PaymentStatus.PENDING;
      }

      return {
        ...booking,
        payment,
      };
    } catch (error) {
      this.logger.error(
        `Failed to create booking: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENEW — Extend lease for current tenant (priority window)
  // ═══════════════════════════════════════════════════════════════════════════

  async renewBooking(
    bookingId: string,
    userId: string,
    dto: RenewBookingDto,
    token?: string,
  ) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { details: true },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // --- Only the booking owner can renew ---
    if (booking.userId !== userId) {
      throw new BadRequestException('Only the booking owner can renew');
    }

    // --- Only ACTIVE or EXPIRING_SOON bookings can be renewed ---
    if (
      booking.status !== BookingStatus.ACTIVE &&
      booking.status !== BookingStatus.EXPIRING_SOON
    ) {
      throw new BadRequestException(
        `Cannot renew a booking with status ${booking.status}. Only ACTIVE or EXPIRING_SOON bookings can be renewed.`,
      );
    }

    // --- Validate renewal extends by at least MIN_RENTAL_MONTHS ---
    const newEndDate = new Date(dto.newEndDate);
    const extensionMonths = this.calculateMonthsDifference(
      booking.endDate,
      newEndDate,
    );

    if (extensionMonths < MIN_RENTAL_MONTHS) {
      throw new BadRequestException(
        `Renewal must extend by at least ${MIN_RENTAL_MONTHS} months. Requested: ${extensionMonths} months.`,
      );
    }

    // --- Check no overlap with OTHER bookings on same rooms ---
    for (const detail of booking.details) {
      await this.validateNoOverlap(
        detail.roomId,
        booking.endDate, // new period starts at current endDate
        newEndDate,
        bookingId, // exclude this booking from overlap check
      );
    }

    // --- Cancel any QUEUED pre-bookings on these rooms (current tenant has priority) ---
    const roomIds = booking.details.map((d) => d.roomId);
    await this.cancelQueuedBookingsForRooms(roomIds, booking.endDate);

    // --- Update the booking ---
    const totalNewDuration = this.calculateMonthsDifference(
      booking.startDate,
      newEndDate,
    );

    const updatedBooking = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        endDate: newEndDate,
        durationMonths: totalNewDuration,
        status: BookingStatus.ACTIVE, // Reset from EXPIRING_SOON to ACTIVE
        isRelisted: false,
        renewalDeadline: null,
      },
      include: { details: true },
    });

    // --- Create payment for renewal period ---
    const renewalAmount = booking.details.reduce(
      (sum, d) => sum + d.price * extensionMonths,
      0,
    );

    let payment: any = null;
    try {
      payment = await this.createPaymentSession({
        bookingId: updatedBooking.id,
        userId,
        amount: renewalAmount,
        paymentMethod: dto.paymentMethod,
      });
    } catch (paymentError) {
      this.logger.error(
        `Payment failed for renewal of ${bookingId}, reverting: ${paymentError.message}`,
      );
      // Revert booking changes
      await this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          endDate: booking.endDate,
          durationMonths: booking.durationMonths,
          status: booking.status,
          isRelisted: booking.isRelisted,
        },
      });
      throw paymentError;
    }

    // --- Update cache ---
    await this.redisService.set(`booking:${bookingId}`, updatedBooking, 3600);

    // --- Publish event ---
    this.publishEventSafe('booking.renewed', {
      bookingId: updatedBooking.id,
      userId: updatedBooking.userId,
      previousEndDate: booking.endDate,
      newEndDate: updatedBooking.endDate,
      extensionMonths,
      details: updatedBooking.details.map((d) => d.roomId),
    });

    this.logger.log(
      `Booking ${bookingId} renewed: extended by ${extensionMonths} months to ${newEndDate.toISOString()}`,
    );

    return { ...updatedBooking, payment };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // READ
  // ═══════════════════════════════════════════════════════════════════════════

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

  async findOne(id: string, token?: string) {
    const cachedBooking = await this.redisService.get(`booking:${id}`);
    if (cachedBooking) {
      this.logger.debug(`Cache hit for booking:${id}`);
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

    const enriched = await this.enrichBookingsWithExternalData(
      [booking],
      token,
    );
    const enrichedBooking = enriched[0];

    // Cache booking (without external data to avoid stale data)
    await this.redisService.set(`booking:${id}`, booking, 3600);
    this.logger.debug(`Cached booking:${id}`);

    return enrichedBooking;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE / STATUS CHANGE
  // ═══════════════════════════════════════════════════════════════════════════

  async update(id: string, dto: UpdateBookingDto) {
    try {
      const booking = await this.prisma.booking.update({
        where: { id },
        data: {
          status: dto.status,
          details: {
            update: dto.details?.map((d) => ({
              where: { id: d.id },
              data: {
                price: d.price,
              },
            })),
          },
        },
        include: { details: true },
      });

      await this.redisService.set(`booking:${id}`, booking, 3600);
      this.logger.debug(`Updated cache for booking:${id}`);

      this.publishEventSafe('booking.updated', {
        bookingId: booking.id,
        status: booking.status,
        details: booking.details.map((d) => ({
          roomId: d.roomId,
          price: d.price,
        })),
      });

      return booking;
    } catch (error) {
      this.logger.error(
        `Failed to update booking ${id}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Update booking status. Handles both CONFIRMED and CANCELED transitions.
   * Previously named cancel() — renamed for clarity.
   */
  async updateStatus(id: string, status: BookingStatus) {
    try {
      // Validate: only CONFIRMED or CANCELED are allowed from the API
      if (
        status !== BookingStatus.CONFIRMED &&
        status !== BookingStatus.CANCELED
      ) {
        throw new BadRequestException(
          `Invalid status: ${status}. Only CONFIRMED or CANCELED are allowed.`,
        );
      }

      const booking = await this.prisma.booking.update({
        where: { id },
        data: { status },
        include: { details: true },
      });

      await this.redisService.set(`booking:${id}`, booking, 3600);

      const bookingStatusEvent: any = {
        bookingId: booking.id,
        userId: booking.userId,
        status: booking.status,
        details: booking.details.map((d) => d.roomId),
      };

      try {
        if (status === BookingStatus.CANCELED) {
          await this.rabbitMQService.publishBookingCanceled(bookingStatusEvent);
          this.logger.log(`Published booking.canceled event: ${booking.id}`);

          const totalAmount = booking.details.reduce(
            (sum, detail) => sum + detail.price,
            0,
          );
          await this.rabbitMQService.publishPaymentCancel({
            bookingId: booking.id,
            userId: booking.userId,
            amount: totalAmount,
            eventType: 'payment.cancel',
            metadata: {
              reason: 'Booking cancelled by user',
              cancelledAt: new Date().toISOString(),
            },
          });
          this.logger.log(
            `Published payment.cancel event for booking: ${booking.id}`,
          );
        } else if (status === BookingStatus.CONFIRMED) {
          await this.rabbitMQService.publishBookingConfirmed(
            bookingStatusEvent,
          );
          this.logger.log(`Published booking.confirmed event: ${booking.id}`);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to publish RabbitMQ events for booking ${booking.id}: ${error.message || error}`,
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

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERIES
  // ═══════════════════════════════════════════════════════════════════════════

  async getBookingByUserId(userId: string) {
    return this.prisma.booking.findMany({
      where: { userId },
      include: { details: true },
    });
  }

  async getBookingByRoomId(
    roomId: string,
    token?: string,
    status?: string | string[],
  ) {
    const whereClause: any = {
      details: { some: { roomId } },
    };

    if (status) {
      const statuses = Array.isArray(status) ? status : [status];
      whereClause.status = {
        in: statuses.map((s) => s.toUpperCase() as BookingStatus),
      };
    }

    const bookings = await this.prisma.booking.findMany({
      where: whereClause,
      include: { details: true },
      orderBy: { createdAt: 'desc' },
    });

    return this.enrichBookingsWithExternalData(bookings, token);
  }

  async delete(id: string) {
    try {
      const booking = await this.prisma.booking.delete({
        where: { id },
      });

      await this.redisService.del(`booking:${id}`);
      this.logger.debug(`Removed booking:${id} from cache`);

      return booking;
    } catch (error) {
      this.logger.error(
        `Failed to delete booking ${id}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════════════════

  async getStats(year?: number) {
    const currentYear = year || new Date().getFullYear();

    const [total, pending, confirmed, cancelled, active, expiringSoon, queued] =
      await Promise.all([
        this.prisma.booking.count(),
        this.prisma.booking.count({ where: { status: BookingStatus.PENDING } }),
        this.prisma.booking.count({
          where: { status: BookingStatus.CONFIRMED },
        }),
        this.prisma.booking.count({
          where: { status: BookingStatus.CANCELED },
        }),
        this.prisma.booking.count({ where: { status: BookingStatus.ACTIVE } }),
        this.prisma.booking.count({
          where: { status: BookingStatus.EXPIRING_SOON },
        }),
        this.prisma.booking.count({ where: { status: BookingStatus.QUEUED } }),
      ]);

    const monthlyBookings = await this.getMonthlyBookings(currentYear);

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const [bookingsThisMonth, bookingsLastMonth] = await Promise.all([
      this.prisma.booking.count({
        where: { createdAt: { gte: startOfMonth } },
      }),
      this.prisma.booking.count({
        where: {
          createdAt: { gte: lastMonth, lte: endOfLastMonth },
        },
      }),
    ]);

    const bookingGrowth =
      bookingsLastMonth > 0
        ? ((bookingsThisMonth - bookingsLastMonth) / bookingsLastMonth) * 100
        : bookingsThisMonth > 0
          ? 100
          : 0;

    return {
      totalBookings: total,
      pendingBookings: pending,
      confirmedBookings: confirmed,
      cancelledBookings: cancelled,
      activeBookings: active,
      expiringSoonBookings: expiringSoon,
      queuedBookings: queued,
      bookingsThisMonth,
      bookingsLastMonth,
      bookingGrowth: Math.round(bookingGrowth * 100) / 100,
      monthlyBookings,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAYMENT STATUS UPDATE (from RabbitMQ consumer)
  // ═══════════════════════════════════════════════════════════════════════════

  async updateBookingPaymentStatus(
    bookingId: string,
    bookingStatus: BookingStatus,
    paymentStatus: PaymentStatus,
  ) {
    try {
      const booking = await this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: bookingStatus,
          paymentStatus: paymentStatus,
        },
        include: { details: true },
      });

      await this.redisService.set(`booking:${bookingId}`, booking, 3600);
      this.logger.log(
        `Booking ${bookingId} updated: status=${bookingStatus}, paymentStatus=${paymentStatus}`,
      );

      return booking;
    } catch (error) {
      this.logger.error(
        `Failed to update booking payment status for ${bookingId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async hasCompletedBooking(
    userId: string,
    roomId: string,
  ): Promise<string | null> {
    const booking = await this.prisma.booking.findFirst({
      where: {
        userId,
        details: {
          some: {
            roomId,
          },
        },
        paymentStatus: PaymentStatus.SUCCESS,
        status: {
          in: [BookingStatus.CONFIRMED, BookingStatus.ACTIVE, BookingStatus.COMPLETED],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    return booking ? booking.id : null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE — Validation Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calculate the number of full months between two dates.
   * Uses a floor approach: 3 months and 15 days = 3 months.
   */
  private calculateMonthsDifference(start: Date, end: Date): number {
    const years = end.getFullYear() - start.getFullYear();
    const months = end.getMonth() - start.getMonth();
    const dayDiff = end.getDate() - start.getDate();

    let totalMonths = years * 12 + months;
    // If end day is before start day, we haven't completed the last month
    if (dayDiff < 0) {
      totalMonths--;
    }

    return totalMonths;
  }

  /**
   * Validate that no active/confirmed booking overlaps with the requested date range.
   * @param excludeBookingId - Optionally exclude a booking (used in renewals)
   */
  private async validateNoOverlap(
    roomId: string,
    startDate: Date,
    endDate: Date,
    excludeBookingId?: string,
  ): Promise<void> {
    const overlapping = await this.prisma.booking.findFirst({
      where: {
        ...(excludeBookingId && { id: { not: excludeBookingId } }),
        status: {
          in: [
            BookingStatus.CONFIRMED,
            BookingStatus.ACTIVE,
            BookingStatus.EXPIRING_SOON,
          ],
        },
        details: {
          some: { roomId },
        },
        // Overlap condition: booking A overlaps B if A.start < B.end AND A.end > B.start
        startDate: { lt: endDate },
        endDate: { gt: startDate },
      },
      select: { id: true, startDate: true, endDate: true },
    });

    if (overlapping) {
      throw new BadRequestException(
        `Room ${roomId} is already booked from ${overlapping.startDate.toISOString()} to ${overlapping.endDate.toISOString()}`,
      );
    }
  }

  /**
   * Check if any of the requested rooms have an EXPIRING_SOON booking,
   * making this a valid pre-booking.
   */
  private async isPreBookingEligible(
    roomIds: string[],
    requestedStartDate: Date,
  ): Promise<boolean> {
    const expiringBooking = await this.prisma.booking.findFirst({
      where: {
        status: BookingStatus.EXPIRING_SOON,
        details: {
          some: { roomId: { in: roomIds } },
        },
      },
      select: { endDate: true },
    });

    if (!expiringBooking) {
      return false;
    }

    // Pre-booking's startDate should be at or after the expiring booking's endDate
    // Allow a small tolerance (same day is fine)
    const expiringEnd = expiringBooking.endDate;
    const diffMs = requestedStartDate.getTime() - expiringEnd.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    // startDate should be within -1 to +7 days of the expiring endDate
    return diffDays >= -1 && diffDays <= 7;
  }

  /**
   * Cancel all QUEUED pre-bookings for the given rooms starting after a date.
   * Used when current tenant renews their lease.
   */
  private async cancelQueuedBookingsForRooms(
    roomIds: string[],
    afterDate: Date,
  ): Promise<void> {
    const queuedBookings = await this.prisma.booking.findMany({
      where: {
        status: BookingStatus.QUEUED,
        startDate: { gte: afterDate },
        details: {
          some: { roomId: { in: roomIds } },
        },
      },
      select: { id: true, userId: true },
    });

    if (queuedBookings.length === 0) return;

    await this.prisma.booking.updateMany({
      where: {
        id: { in: queuedBookings.map((b) => b.id) },
      },
      data: {
        status: BookingStatus.CANCELED,
      },
    });

    // Notify each affected user that their pre-booking was cancelled
    for (const queuedBooking of queuedBookings) {
      this.publishEventSafe('booking.queued_canceled', {
        bookingId: queuedBooking.id,
        userId: queuedBooking.userId,
        reason: 'Current tenant renewed their lease',
      });
    }

    this.logger.log(
      `Cancelled ${queuedBookings.length} queued pre-bookings due to tenant renewal`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE — Data Enrichment
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Enrich bookings with user and room data from external services.
   */
  private async enrichBookingsWithExternalData(
    bookings: any[],
    token?: string,
  ): Promise<any[]> {
    if (bookings.length === 0) {
      return bookings;
    }

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

    const [usersMap, roomsMap] = await Promise.all([
      this.externalService.getUsersByIds(userIds, token),
      this.externalService.getRoomsByIds(roomIds, token),
    ]);

    return bookings.map((booking) => ({
      ...booking,
      user: usersMap.get(booking.userId) || null,
      details:
        booking.details?.map((detail: any) => ({
          ...detail,
          room: roomsMap.get(detail.roomId) || null,
        })) || [],
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE — Payment
  // ═══════════════════════════════════════════════════════════════════════════

  private normalizePaymentMethod(
    method?: string,
  ): 'VIETQR' | 'VNPAY' | 'MOMO' | 'PAYOS' {
    if (!method) {
      throw new Error('typePayment is required');
    }

    const normalized = method.trim().toUpperCase();
    if (
      normalized !== 'VIETQR' &&
      normalized !== 'VNPAY' &&
      normalized !== 'MOMO' &&
      normalized !== 'PAYOS'
    ) {
      throw new Error('Unsupported payment method');
    }

    return normalized;
  }

  private async createPaymentSession(payload: {
    bookingId: string;
    userId: string;
    amount: number;
    paymentMethod: string;
  }) {
    const paymentMethod = this.normalizePaymentMethod(payload.paymentMethod);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${this.paymentServiceUrl}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': payload.userId,
        },
        body: JSON.stringify({
          bookingId: payload.bookingId,
          amount: payload.amount,
          method: paymentMethod,
        }),
        signal: controller.signal,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          data?.message || `Payment service error (${response.status})`;
        throw new Error(message);
      }

      return data;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Payment service request timed out');
      }
      throw new Error(error.message || 'Failed to create payment session');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async safeDeleteBooking(id: string) {
    try {
      await this.prisma.booking.delete({ where: { id } });
      this.logger.warn(
        `Rolled back booking ${id} because payment session creation failed`,
      );
    } catch (rollbackError) {
      this.logger.error(
        `Failed to rollback booking ${id}: ${rollbackError.message}`,
        rollbackError.stack,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE — Monthly Stats
  // ═══════════════════════════════════════════════════════════════════════════

  private async getMonthlyBookings(year: number) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];

    const result = await Promise.all(
      months.map(async (month, index) => {
        const startOfMonth = new Date(year, index, 1);
        const endOfMonth = new Date(year, index + 1, 0, 23, 59, 59, 999);

        const count = await this.prisma.booking.count({
          where: {
            createdAt: {
              gte: startOfMonth,
              lte: endOfMonth,
            },
          },
        });

        return { month, count };
      }),
    );

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE — Event Publishing (fire-and-forget with logging)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Publish an event safely — never throws, always logs failures.
   * Consolidates the repetitive try/catch pattern across the service.
   */
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
