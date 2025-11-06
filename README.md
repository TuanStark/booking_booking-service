# 📅 Booking Service

Service quản lý đặt phòng cho hệ thống Dorm Booking System. Service này xử lý tạo booking, cập nhật trạng thái, hủy booking, và tích hợp với các services khác qua Kafka và RabbitMQ.

## 🚀 Tính năng

### **Booking Management**
- ✅ Tạo booking mới
- ✅ Lấy danh sách bookings
- ✅ Lấy booking theo ID
- ✅ Cập nhật booking
- ✅ Hủy booking
- ✅ Lấy bookings theo user
- ✅ Lấy bookings theo room
- ✅ Lọc và phân trang

### **Integration**
- ✅ Kafka event publishing (booking.created, booking.canceled, booking.updated)
- ✅ RabbitMQ integration (payment communication)
- ✅ Redis caching
- ✅ External service calls (room validation, payment status)

### **Business Logic**
- ✅ Booking validation
- ✅ Date range validation
- ✅ Room availability checking
- ✅ Price calculation
- ✅ Status management

## 📁 Cấu trúc thư mục

```
src/
├── modules/
│   └── bookings/         # Booking module
│       ├── dto/         # Data Transfer Objects
│       ├── bookings.controller.ts
│       ├── bookings.service.ts
│       └── bookings.module.ts
├── messaging/
│   ├── kafka/           # Kafka integration
│   │   ├── kafka.module.ts
│   │   ├── kafka.producer.service.ts
│   │   └── kafka-topics.enum.ts
│   └── rabbitmq/        # RabbitMQ integration
│       ├── rabbitmq.module.ts
│       └── rabbitmq.producer.service.ts
├── common/
│   ├── external/        # External service calls
│   └── global/          # Global DTOs
├── prisma/
│   ├── schema.prisma    # Database schema
│   └── prisma.service.ts
└── main.ts
```

## ⚙️ Cấu hình

### **Environment Variables**

Tạo file `.env` trong thư mục root:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/booking_db"

# Application
PORT=3005
NODE_ENV=development

# Kafka
KAFKA_BROKER=localhost:9092
KAFKA_CLIENT_ID=booking-service
KAFKA_GROUP_ID=booking-service-group

# RabbitMQ
RABBITMQ_URL=amqp://localhost:5672
RABBITMQ_QUEUE=payment_queue

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_TTL=3600

# External Services
ROOM_SERVICE_URL=http://localhost:3002
PAYMENT_SERVICE_URL=http://localhost:3004
```

## 🚀 Cài đặt và chạy

### **Yêu cầu**
- Node.js 18+
- PostgreSQL
- Kafka
- RabbitMQ (optional)
- Redis (optional)

### **Cài đặt**

```bash
# Cài đặt dependencies
npm install

# Tạo file .env
cp .env.example .env

# Chỉnh sửa .env với thông tin của bạn

# Chạy database migrations
npx prisma migrate dev

# Generate Prisma Client
npx prisma generate
```

### **Chạy development**

```bash
npm run start:dev
# hoặc
npm run dev
```

### **Build và chạy production**

```bash
# Build
npm run build

# Chạy production
npm run start:prod
```

## 📡 API Endpoints

### **Booking Management**

#### `POST /bookings`
Tạo booking mới

**Headers:**
```
Authorization: Bearer <access-token>
x-user-id: <user-id>
```

**Request Body:**
```json
{
  "startDate": "2025-01-01",
  "endDate": "2025-01-05",
  "details": [
    {
      "roomId": "room-uuid",
      "price": 500000,
      "time": 4,
      "note": "Optional note"
    }
  ]
}
```

**Response:**
```json
{
  "id": "booking-uuid",
  "userId": "user-uuid",
  "status": "PENDING",
  "startDate": "2025-01-01T00:00:00.000Z",
  "endDate": "2025-01-05T00:00:00.000Z",
  "details": [
    {
      "id": "detail-uuid",
      "roomId": "room-uuid",
      "price": 500000,
      "time": 4,
      "note": "Optional note"
    }
  ],
  "createdAt": "2025-01-01T00:00:00.000Z",
  "updatedAt": "2025-01-01T00:00:00.000Z"
}
```

#### `GET /bookings`
Lấy danh sách bookings (với phân trang và lọc)

**Query Parameters:**
- `page`: Số trang (default: 1)
- `limit`: Số items mỗi trang (default: 10)
- `status`: Lọc theo status (PENDING, CONFIRMED, CANCELLED, COMPLETED)
- `userId`: Lọc theo user ID
- `roomId`: Lọc theo room ID

**Example:**
```
GET /bookings?page=1&limit=10&status=PENDING
```

#### `GET /bookings/:id`
Lấy booking theo ID

#### `PATCH /bookings/:id`
Cập nhật booking

**Request Body:**
```json
{
  "status": "CONFIRMED",
  "startDate": "2025-01-01",
  "endDate": "2025-01-05"
}
```

#### `DELETE /bookings/:id`
Hủy booking

#### `GET /bookings/user/:userId`
Lấy bookings theo user ID

#### `GET /bookings/room/:roomId`
Lấy bookings theo room ID

## 🔄 Kafka Events

Service publish các events sau lên Kafka:

### **booking.created**
Khi booking mới được tạo

```json
{
  "bookingId": "booking-uuid",
  "userId": "user-uuid",
  "status": "PENDING",
  "startDate": "2025-01-01T00:00:00.000Z",
  "endDate": "2025-01-05T00:00:00.000Z",
  "details": [
    {
      "roomId": "room-uuid",
      "price": 500000,
      "time": 4
    }
  ]
}
```

### **booking.updated**
Khi booking được cập nhật

### **booking.canceled**
Khi booking bị hủy

## 🔄 RabbitMQ Integration

Service sử dụng RabbitMQ để:
- Gửi events về payment service
- Nhận payment status updates

## 📝 Database Schema

Service sử dụng Prisma ORM. Xem file `prisma/schema.prisma` để biết chi tiết schema.

### **Main Models:**
- `Booking` - Thông tin booking
- `BookingDetail` - Chi tiết booking (rooms, prices)

### **Booking Status:**
- `PENDING` - Đang chờ xác nhận
- `CONFIRMED` - Đã xác nhận
- `CANCELLED` - Đã hủy
- `COMPLETED` - Đã hoàn thành

## 🧪 Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

## 📚 Tài liệu thêm

- [FLOW_EXPLANATION.md](./FLOW_EXPLANATION.md) - Giải thích flow của booking
- [KAFKA_EVENT_HANDLING.md](./KAFKA_EVENT_HANDLING.md) - Chi tiết về Kafka events
- [RABBITMQ_INTEGRATION.md](./RABBITMQ_INTEGRATION.md) - Chi tiết về RabbitMQ integration

## 🐳 Docker

```bash
# Build image
docker build -t booking-service .

# Run với docker-compose
docker-compose up
```

## 🔒 Security

- JWT authentication (từ API Gateway)
- User ID validation từ headers
- Input validation với class-validator
- SQL injection protection (Prisma)

## 📄 License

MIT
