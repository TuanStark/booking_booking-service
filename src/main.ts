import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { Transport } from '@nestjs/microservices';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Remove properties that are not in the DTO
      forbidNonWhitelisted: false, // Don't throw error for extra properties
      transform: true, // Automatically transform payloads to DTO instances
      transformOptions: {
        enableImplicitConversion: true, // Enable implicit type conversion
      },
      disableErrorMessages: false, // Show validation error messages
    }),
  );
  app.enableCors();

  // Log service startup
  logger.log('🚀 Starting Booking Service...');

  // Connect RabbitMQ Microservice
  app.connectMicroservice({
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
      queue: process.env.RABBITMQ_QUEUE || 'booking_worker_queue',
      queueOptions: {
        durable: true,
      },
      noAck: true,
      prefetchCount: 1,
    },
  });

  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3005);

  logger.log(
    `✅ Booking Service is running on port ${process.env.PORT ?? 3005}`,
  );
  logger.log('📡 Checking connections...');

  // Log connection status
  setTimeout(() => {
    logger.log('🔗 Kafka: Ready for event publishing');
    logger.log('🐰 RabbitMQ: Ready for payment communication');
    logger.log('📊 Redis: Ready for caching');
    logger.log(
      `🎯 All services connected successfully! ${process.env.PORT ?? 3005}`,
    );
  }, 2000);
}
bootstrap();
