# 🐰 RabbitMQ Integration - Booking Service

## 📋 Tổng quan

Booking Service đã được tích hợp với RabbitMQ để giao tiếp với Payment Service thông qua message queue.

## 🔧 Cấu hình

### Environment Variables
```env
RABBITMQ_URL=amqp://localhost:5672
```

### Dependencies đã thêm
- `amqplib`: RabbitMQ client cho Node.js
- `@types/amqplib`: TypeScript types

## 🎯 Các Event được gửi

### **1. Payment Request Event**
Khi tạo booking mới:
```typescript
{
  bookingId: string;
  userId: string;
  amount: number;
  eventType: 'payment.request';
  metadata: {
    startDate: Date;
    endDate: Date;
    roomIds: string[];
  };
}
```

### **2. Payment Cancel Event**
Khi hủy booking:
```typescript
{
  bookingId: string;
  userId: string;
  amount: number;
  eventType: 'payment.cancel';
  metadata: {
    reason: string;
    cancelledAt: string;
  };
}
```

## 🔄 Luồng hoạt động

### **Scenario 1: Tạo booking thành công**
```
1. User tạo booking → Booking Service
2. Booking Service tạo booking record
3. Booking Service gửi Kafka event (cho các service khác)
4. Booking Service gửi RabbitMQ payment.request event
5. Payment Service nhận event → Tạo payment PENDING
```

### **Scenario 2: Hủy booking**
```
1. User hủy booking → Booking Service
2. Booking Service cập nhật status = CANCELED
3. Booking Service gửi Kafka event (cho các service khác)
4. Booking Service gửi RabbitMQ payment.cancel event
5. Payment Service nhận event → Cancel payment
```

## 📁 Cấu trúc Files

```
src/messaging/rabbitmq/
├── rabbitmq.module.ts          # RabbitMQ module
├── rabbitmq.producer.service.ts # Producer service
└── rabbitmq.consumer.service.ts # Consumer service
```

## 🚀 Cách sử dụng

### **1. Producer Service**
```typescript
// Inject vào service
constructor(
  private rabbitMQService: RabbitMQProducerService,
) {}

// Gửi payment request
await this.rabbitMQService.sendPaymentRequest({
  bookingId: 'booking-id',
  userId: 'user-id',
  amount: 500000,
  eventType: 'payment.request',
  metadata: { /* additional data */ }
});

// Gửi payment cancel
await this.rabbitMQService.sendPaymentCancel({
  bookingId: 'booking-id',
  userId: 'user-id',
  amount: 500000,
  eventType: 'payment.cancel',
  metadata: { reason: 'User cancelled' }
});
```

### **2. Consumer Service**
Consumer service sẽ tự động nhận và xử lý các payment response events từ Payment Service.

## 🔧 RabbitMQ Setup

### **Exchange & Queue**
- **Exchange**: `booking.payments` (direct, durable)
- **Queue**: `payment.requests` (durable)
- **Routing Keys**: 
  - `payment.request` → Payment request events
  - `payment.cancel` → Payment cancel events

### **Response Exchange & Queue**
- **Exchange**: `payment.responses` (direct, durable)
- **Queue**: `payment.responses.booking` (durable)
- **Routing Key**: `payment.response` → Payment response events

## ⚠️ Lưu ý

1. **Error Handling**: Service sẽ tiếp tục hoạt động ngay cả khi RabbitMQ không khả dụng
2. **Message Persistence**: Tất cả messages đều được đánh dấu persistent
3. **Connection Management**: Tự động reconnect khi connection bị mất
4. **Logging**: Tất cả events đều được log để debug

## 🧪 Testing

Để test RabbitMQ integration:

1. **Start RabbitMQ**: `docker-compose up rabbitmq`
2. **Start Booking Service**: `npm run start:dev`
3. **Create booking**: POST `/bookings` với valid data
4. **Check logs**: Xem RabbitMQ events trong console logs
5. **Check RabbitMQ Management UI**: http://localhost:15672 (guest/guest)
