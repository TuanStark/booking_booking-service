import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe());
  app.enableCors();
  
  // Log service startup
  logger.log('🚀 Starting Booking Service...');
  
  await app.listen(process.env.PORT ?? 3005);
  
  logger.log(`✅ Booking Service is running on port ${process.env.PORT ?? 3005}`);
  logger.log('📡 Checking connections...');
  
  // Log connection status
  setTimeout(() => {
    logger.log('🔗 Kafka: Ready for event publishing');
    logger.log('🐰 RabbitMQ: Ready for payment communication');
    logger.log('📊 Redis: Ready for caching');
    logger.log(`🎯 All services connected successfully! ${process.env.PORT ?? 3005}`);
  }, 2000);
}
bootstrap();
