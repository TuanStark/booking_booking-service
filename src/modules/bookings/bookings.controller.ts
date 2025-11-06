import { Controller, Get, Post, Body, Patch, Param, Delete, BadRequestException, Query, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { BookingService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { HttpMessage, HttpStatus } from 'src/common/global/globalEnum';
import { ResponseData } from 'src/common/global/globalClass';
import { FindAllDto } from 'src/common/global/find-all.dto';
import { BookingStatus } from '@prisma/client';

@Controller('bookings')
export class BookingController {
  constructor(private readonly bookingsService: BookingService) { }

  @Post()
  async create(@Body() createBookingDto: CreateBookingDto, @Req() req: Request) {
    // Extract userId from x-user-id header sent by API Gateway
    const userId = req.headers['x-user-id'] as string;
    console.log('Create booking request received:', createBookingDto);
    console.log('Create booking request received:', req);
    console.log('UserId from header:', userId);
    
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    
    try {
      const booking = await this.bookingsService.create(userId, createBookingDto);
      return new ResponseData(booking, HttpStatus.CREATED, HttpMessage.CREATED);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Get()
  async findAll(@Query() query: FindAllDto, @Req() req: Request) {
    try {
      // Lấy token từ request header (từ API Gateway forward xuống)
      const authHeader = req.headers['authorization'] as string;
      const token = authHeader?.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : authHeader;
      const bookings = await this.bookingsService.findAll(query, token);
      return new ResponseData(bookings, HttpStatus.SUCCESS, HttpMessage.SUCCESS);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: Request) {
    try {
      // Lấy token từ request header
      const authHeader = req.headers['authorization'] as string;
      const token = authHeader?.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : authHeader;
      
      const booking = await this.bookingsService.findOne(id, token);
      return new ResponseData(booking, HttpStatus.SUCCESS, HttpMessage.SUCCESS);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Patch('update/:id')
  async update(@Param('id') id: string, @Body() updateBookingDto: UpdateBookingDto) {
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
      
      // Validate status
      if (!status || !['CONFIRMED', 'CANCELED'].includes(status)) {
        throw new BadRequestException(
          'Status is required and must be either CONFIRMED or CANCELED',
        );
      }

      const booking = await this.bookingsService.cancel(id, status);
      return new ResponseData(booking, HttpStatus.SUCCESS, HttpMessage.SUCCESS);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }


  @Get('user/:userId')
  async getBookingByUserId(@Param('userId') userId: string) {
    try {
      const booking = await this.bookingsService.getBookingByUserId(userId);
      return new ResponseData(booking, HttpStatus.SUCCESS, HttpMessage.SUCCESS);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Get('room/:roomId')
  async getBookingByRoomId(@Param('roomId') roomId: string) {
    try {
      const booking = await this.bookingsService.getBookingByRoomId(roomId);
      return new ResponseData(booking, HttpStatus.SUCCESS, HttpMessage.SUCCESS);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    try {
      const booking = await this.bookingsService.delete(id);
      return new ResponseData(booking, HttpStatus.NO_CONTENT, HttpMessage.SUCCESS);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
