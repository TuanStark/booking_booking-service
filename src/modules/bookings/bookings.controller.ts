import { Controller, Get, Post, Body, Patch, Param, Delete, BadRequestException, Query } from '@nestjs/common';
import { BookingService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { HttpMessage, HttpStatus } from 'src/common/global/globalEnum';
import { ResponseData } from 'src/common/global/globalClass';
import { FindAllDto } from 'src/common/global/find-all.dto';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingService) {}

  @Post()
  async create(@Body() createBookingDto: CreateBookingDto) {
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

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateBookingDto: UpdateBookingDto) {
    try {
      const booking = await this.bookingsService.update(id, updateBookingDto);
      return new ResponseData(booking, HttpStatus.SUCCESS, HttpMessage.SUCCESS);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
    }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      const booking = await this.bookingsService.cancel(id);
      return new ResponseData(booking, HttpStatus.NO_CONTENT, HttpMessage.SUCCESS);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
