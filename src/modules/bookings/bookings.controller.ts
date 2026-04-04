import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  BadRequestException,
  Query,
  Put,
  Req,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { BookingService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { RenewBookingDto } from './dto/renew-booking.dto';
import { HttpMessage, HttpStatus } from 'src/common/global/globalEnum';
import { ResponseData } from 'src/common/global/globalClass';
import { FindAllDto } from 'src/common/global/find-all.dto';
import { BookingStatus } from './dto/enum';

@Controller('bookings')
export class BookingController {
  private readonly logger = new Logger(BookingController.name);

  constructor(private readonly bookingsService: BookingService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Helper — extract userId and token from request headers
  // ═══════════════════════════════════════════════════════════════════════════

  private extractUserId(req: Request): string {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    return userId;
  }

  private extractToken(req: Request): string | undefined {
    const authHeader = req.headers['authorization'] as string;
    return authHeader?.startsWith('Bearer ')
      ? authHeader.substring(7)
      : authHeader;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE
  // ═══════════════════════════════════════════════════════════════════════════

  @Post()
  async create(
    @Body() createBookingDto: CreateBookingDto,
    @Req() req: Request,
  ) {
    const userId = this.extractUserId(req);
    const token = this.extractToken(req);

    this.logger.log(`Create booking request from user: ${userId}`);

    try {
      const booking = await this.bookingsService.create(
        userId,
        createBookingDto,
        token,
      );
      return new ResponseData(booking, HttpStatus.CREATED, HttpMessage.CREATED);
    } catch (error) {
      this.logger.error(`Error creating booking: ${error.message}`);
      const errorMessage =
        error?.message || 'Failed to create booking. Please try again.';
      throw new BadRequestException(errorMessage);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENEW — Extend lease for current tenant
  // ═══════════════════════════════════════════════════════════════════════════

  @Post(':id/renew')
  async renew(
    @Param('id') id: string,
    @Body() renewBookingDto: RenewBookingDto,
    @Req() req: Request,
  ) {
    const userId = this.extractUserId(req);
    const token = this.extractToken(req);

    this.logger.log(`Renew booking ${id} request from user: ${userId}`);

    try {
      const booking = await this.bookingsService.renewBooking(
        id,
        userId,
        renewBookingDto,
        token,
      );
      return new ResponseData(booking, HttpStatus.SUCCESS, HttpMessage.SUCCESS);
    } catch (error) {
      this.logger.error(`Error renewing booking: ${error.message}`);
      throw new BadRequestException(error.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // READ
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('check-reviewed')
  async checkUserBookedRoom(
    @Req() req: Request,
    @Query('roomId') roomId: string,
  ) {
    const userId = this.extractUserId(req);
    const bookingId = await this.bookingsService.hasCompletedBooking(
      userId,
      roomId,
    );
    return { bookingId };
  }

  @Get('my-bookings')
  async getBookingByUserId(@Req() req: Request) {
    try {
      const userId = this.extractUserId(req);
      const booking = await this.bookingsService.getBookingByUserId(userId);
      return new ResponseData(booking, HttpStatus.SUCCESS, HttpMessage.SUCCESS);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Get()
  async findAll(@Query() query: FindAllDto, @Req() req: Request) {
    try {
      const token = this.extractToken(req);
      const bookings = await this.bookingsService.findAll(query, token);
      return new ResponseData(
        bookings,
        HttpStatus.SUCCESS,
        HttpMessage.SUCCESS,
      );
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Get('stats')
  async getStats(@Query('year') year?: number) {
    try {
      const stats = await this.bookingsService.getStats(year);
      return new ResponseData(stats, HttpStatus.SUCCESS, HttpMessage.SUCCESS);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Get('calendar-filter')
  async getCalendarBookings(
    @Query('roomIds') roomIds: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Req() req: Request,
  ) {
    try {
      if (!roomIds || !startDate || !endDate) {
        throw new BadRequestException('roomIds, startDate, and endDate are required');
      }
      
      const token = this.extractToken(req);
      const roomIdArray = roomIds.split(',');
      const bookings = await this.bookingsService.getCalendarBookings(
        roomIdArray,
        startDate,
        endDate,
        token
      );
      
      return new ResponseData(bookings, HttpStatus.SUCCESS, HttpMessage.SUCCESS);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: Request) {
    try {
      const token = this.extractToken(req);
      const booking = await this.bookingsService.findOne(id, token);
      return new ResponseData(booking, HttpStatus.SUCCESS, HttpMessage.SUCCESS);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE
  // ═══════════════════════════════════════════════════════════════════════════

  @Patch('update/:id')
  async update(
    @Param('id') id: string,
    @Body() updateBookingDto: UpdateBookingDto,
  ) {
    try {
      const booking = await this.bookingsService.update(id, updateBookingDto);
      return new ResponseData(booking, HttpStatus.SUCCESS, HttpMessage.SUCCESS);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Put(':id')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: BookingStatus },
  ) {
    try {
      const { status } = body;

      if (!status || !['CONFIRMED', 'CANCELED'].includes(status)) {
        throw new BadRequestException(
          'Status is required and must be either CONFIRMED or CANCELED',
        );
      }

      const booking = await this.bookingsService.updateStatus(id, status);
      return new ResponseData(booking, HttpStatus.SUCCESS, HttpMessage.SUCCESS);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROOM QUERIES
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('room/:roomId')
  async getBookingByRoomId(
    @Param('roomId') roomId: string,
    @Req() req: Request,
    @Query('status') status?: string | string[],
  ) {
    try {
      const token = this.extractToken(req);
      const booking = await this.bookingsService.getBookingByRoomId(roomId, token, status);
      return new ResponseData(booking, HttpStatus.SUCCESS, HttpMessage.SUCCESS);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE
  // ═══════════════════════════════════════════════════════════════════════════

  @Delete(':id')
  async delete(@Param('id') id: string) {
    try {
      const booking = await this.bookingsService.delete(id);
      return new ResponseData(
        booking,
        HttpStatus.NO_CONTENT,
        HttpMessage.SUCCESS,
      );
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
