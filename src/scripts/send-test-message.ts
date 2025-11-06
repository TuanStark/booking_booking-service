import * as amqp from 'amqplib';
import * as dotenv from 'dotenv';

dotenv.config();

async function sendTestMessage() {
  try {
    const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost:5672');
    const channel = await connection.createChannel();

    const exchange = process.env.RABBITMQ_EXCHANGE || 'booking_exchange';
    const routingKey = 'booking.created';

    const message = {
      bookingId: 'test-booking-123',
      userId: 'user123',
      status: 'PENDING',
      startDate: new Date().toISOString(),
      endDate: new Date().toISOString(),
      details: [{ roomId: 'room1', price: 100 }],
    };

    await channel.assertExchange(exchange, 'direct', { durable: true });
    channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(message)));
    console.log(`Sent test message to ${exchange} with routing key ${routingKey}`);

    await channel.close();
    await connection.close();
  } catch (error) {
    console.error('Error sending test message:', error);
  }
}

sendTestMessage();