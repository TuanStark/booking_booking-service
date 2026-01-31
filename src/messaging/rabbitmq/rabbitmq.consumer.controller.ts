import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { BookingService } from '../../modules/bookings/bookings.service';
import { BookingStatus, PaymentStatus } from '../../modules/bookings/dto/enum';

interface PaymentEventData {
    paymentId: string;
    bookingId: string;
    amount: number;
    status: string;
    transactionId?: string;
    reference?: string;
}

@Controller()
export class RabbitMQConsumerController {
    private readonly logger = new Logger(RabbitMQConsumerController.name);

    constructor(private readonly bookingService: BookingService) { }

    /**
     * Handle payment.success event from payment service
     * Update booking status to CONFIRMED
     */
    @EventPattern('payment.success')
    async handlePaymentSuccess(
        @Payload() data: PaymentEventData,
        @Ctx() context: RmqContext,
    ) {
        try {
            this.logger.log(
                `Received payment.success event: ${JSON.stringify(data)}`,
            );

            if (!data.bookingId) {
                throw new Error('Missing bookingId in payment event');
            }

            // Update booking status to CONFIRMED and payment status to SUCCESS
            await this.bookingService.updateBookingPaymentStatus(
                data.bookingId,
                BookingStatus.CONFIRMED,
                PaymentStatus.SUCCESS,
            );

            this.logger.log(
                `Booking ${data.bookingId} updated to CONFIRMED after payment success`,
            );

            const channel = context.getChannelRef();
            channel.ack(context.getMessage());
        } catch (error) {
            this.logger.error(
                `Error processing payment.success: ${error.message}`,
                error.stack,
            );
            const channel = context.getChannelRef();
            channel.nack(context.getMessage(), false, true);
        }
    }

    /**
     * Handle payment.failed event from payment service
     * Keep booking status as PENDING or update payment status
     */
    @EventPattern('payment.failed')
    async handlePaymentFailed(
        @Payload() data: PaymentEventData,
        @Ctx() context: RmqContext,
    ) {
        try {
            this.logger.log(
                `Received payment.failed event: ${JSON.stringify(data)}`,
            );

            if (!data.bookingId) {
                throw new Error('Missing bookingId in payment event');
            }

            // Update payment status to FAILED but keep booking as PENDING
            await this.bookingService.updateBookingPaymentStatus(
                data.bookingId,
                BookingStatus.PENDING, // Keep as pending, user can retry payment
                PaymentStatus.FAILED,
            );

            this.logger.log(
                `Booking ${data.bookingId} payment status updated to FAILED`,
            );

            const channel = context.getChannelRef();
            channel.ack(context.getMessage());
        } catch (error) {
            this.logger.error(
                `Error processing payment.failed: ${error.message}`,
                error.stack,
            );
            const channel = context.getChannelRef();
            channel.nack(context.getMessage(), false, true);
        }
    }
}
