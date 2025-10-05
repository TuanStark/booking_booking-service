import { Controller, Get, Post, Body, Patch, Param, Delete, BadRequestException, Query, Put } from '@nestjs/common';
import { BookingService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { HttpMessage, HttpStatus } from 'src/common/global/globalEnum';
import { ResponseData } from 'src/common/global/globalClass';
import { FindAllDto } from 'src/common/global/find-all.dto';

@Controller('bookings')
export class BookingController {
  constructor(private readonly bookingsService: BookingService) { }

  @Post()
  async create(@Body() createBookingDto: CreateBookingDto) {
    console.log('Create booking request received:', createBookingDto);
    try {
      const booking = await this.bookingsService.create(createBookingDto);
      return new ResponseData(booking, HttpStatus.CREATED, HttpMessage.CREATED);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Get()
  async findAll(@Query() query: FindAllDto) {
    try {
      const bookings = await this.bookingsService.findAll(query);
      return new ResponseData(bookings, HttpStatus.SUCCESS, HttpMessage.SUCCESS);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      const booking = await this.bookingsService.findOne(id);
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
  async remove(@Param('id') id: string) {
    try {
      const booking = await this.bookingsService.cancel(id);
      return new ResponseData(booking, HttpStatus.NO_CONTENT, HttpMessage.SUCCESS);
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
