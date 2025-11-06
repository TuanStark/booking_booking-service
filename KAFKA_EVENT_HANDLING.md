# 📅 Kafka Event Handling - Booking Service

## 📋 Tổng quan

Booking Service **NHẬN** events từ Kafka để tự động cập nhật booking status và xử lý các thay đổi liên quan. Booking Service **GỬI** booking events cho các service khác.

## 🎯 Các Event được NHẬN (Chỉ những event thực sự cần thiết)

### **1. Payment Events (Quan trọng nhất):**

#### **`payment.success`**
```json
{
  "bookingId": "bf5e9fb5-3556-4892-9c7d-15e7aaf27603",
  "paymentId": "payment-uuid",
  "amount": 500000,
  "transactionId": "TXN123456",
  "paymentDate": "2025-01-07T10:30:00Z"
}
```

**Xử lý:**
- ✅ Kiểm tra bookingId có tồn tại không
- ✅ Update booking status: `PENDING` → `CONFIRMED`
- ✅ Log thành công

#### **`payment.failed`**
```json
{
  "bookingId": "bf5e9fb5-3556-4892-9c7d-15e7aaf27603",
  "paymentId": "payment-uuid",
  "reason": "Insufficient funds",
  "failedDate": "2025-01-07T10:30:00Z"
}
```

**Xử lý:**
- ✅ Kiểm tra bookingId có tồn tại không
- ✅ Update booking status: `PENDING` → `CANCELED`
- ✅ Log thành công

#### **`payment.refunded`**
```json
{
  "bookingId": "bf5e9fb5-3556-4892-9c7d-15e7aaf27603",
  "paymentId": "payment-uuid",
  "refundAmount": 500000,
  "reason": "Customer request",
  "refundDate": "2025-01-07T10:30:00Z"
}
```

**Xử lý:**
- ✅ Kiểm tra bookingId có tồn tại không
- ✅ Update booking status: `CONFIRMED` → `CANCELED`
- ✅ Log thành công

### **2. Room Events (Chỉ cần thiết):**

#### **`room.deleted`**
```json
{
  "roomId": "room-uuid",
  "buildingId": "building-uuid",
  "deletedAt": "2025-01-07T10:30:00Z"
}
```

**Xử lý:**
- ✅ Tìm tất cả bookings cho room này
- ✅ Cancel tất cả bookings trong tương lai
- ✅ Update booking status: `PENDING/CONFIRMED` → `CANCELED`

## 🚫 Các Event KHÔNG nhận (Đã bỏ đi)

### **❌ Room Events không cần thiết:**
- **`room.created`** - Không cần action gì đặc biệt
- **`room.updated`** - Không cần action gì đặc biệt

### **❌ User Events không cần thiết:**
- **`user.registered`** - Không cần action gì đặc biệt
- **`user.updated`** - Không cần action gì đặc biệt

### **❌ Notification Events không cần thiết:**
- **`notification.sent`** - Không cần action gì đặc biệt

### **❌ Review Events không cần thiết:**
- **`review.created`** - Không cần action gì đặc biệt
- **`review.updated`** - Không cần action gì đặc biệt

### **❌ Booking Events (Circular Dependency):**
- **`booking.created`** - Booking service gửi, không nên nhận
- **`booking.canceled`** - Booking service gửi, không nên nhận

## 🔄 Luồng hoạt động

### **Scenario 1: Booking thành công**
```
1. User tạo booking → Booking Service → booking.created event
2. Payment Service nhận event → Tạo payment PENDING
3. User thanh toán → Payment Service → payment.success event
4. Booking Service nhận event → Booking status: PENDING → CONFIRMED
```

### **Scenario 2: Booking thất bại**
```
1. User tạo booking → Booking Service → booking.created event
2. Payment Service nhận event → Tạo payment PENDING
3. Payment thất bại → Payment Service → payment.failed event
4. Booking Service nhận event → Booking status: PENDING → CANCELED
```

### **Scenario 3: Room bị xóa**
```
1. Admin xóa room → Room Service → room.deleted event
2. Booking Service nhận event → Cancel tất cả future bookings
3. Booking status: PENDING/CONFIRMED → CANCELED
```

## 🛡️ Error Handling

### **Validation Checks:**
- ✅ Kiểm tra bookingId có tồn tại không
- ✅ Kiểm tra booking status hợp lệ
- ✅ Kiểm tra roomId có tồn tại không

### **Error Cases:**
- ❌ Missing bookingId → Log warning, skip
- ❌ Booking not found → Log warning, skip
- ❌ Invalid status transition → Log info, skip
- ❌ Database error → Log error, throw exception

## 📊 Booking Status Flow

```
User tạo booking → PENDING
    ↓
Payment success → CONFIRMED
    ↓
Payment failed → CANCELED
    ↓
Payment refunded → CANCELED
    ↓
Room deleted → CANCELED (future bookings only)
```

## 🔍 Status Transition Rules

### **Payment Events:**
- **payment.success**: `PENDING` → `CONFIRMED`
- **payment.failed**: `PENDING` → `CANCELED`
- **payment.refunded**: `CONFIRMED` → `CANCELED`

### **Room Events:**
- **room.deleted**: `PENDING/CONFIRMED` → `CANCELED` (chỉ future bookings)

## 🧪 Testing

### **Test Payment Events:**

#### **1. Test payment.success:**
```bash
# Gửi event qua Kafka
{
  "topic": "payment.success",
  "message": {
    "bookingId": "bf5e9fb5-3556-4892-9c7d-15e7aaf27603",
    "paymentId": "payment-uuid",
    "amount": 500000,
    "transactionId": "TXN123456"
  }
}

# Kết quả mong đợi:
# ✅ Booking bf5e9fb5-3556-4892-9c7d-15e7aaf27603 confirmed after payment success
```

#### **2. Test payment.failed:**
```bash
# Gửi event qua Kafka
{
  "topic": "payment.failed",
  "message": {
    "bookingId": "bf5e9fb5-3556-4892-9c7d-15e7aaf27603",
    "paymentId": "payment-uuid",
    "reason": "Insufficient funds"
  }
}

# Kết quả mong đợi:
# ✅ Booking bf5e9fb5-3556-4892-9c7d-15e7aaf27603 canceled after payment failed
```

#### **3. Test room.deleted:**
```bash
# Gửi event qua Kafka
{
  "topic": "room.deleted",
  "message": {
    "roomId": "room-uuid",
    "buildingId": "building-uuid"
  }
}

# Kết quả mong đợi:
# ✅ Canceled future booking booking-uuid for deleted room room-uuid
```

## 📝 Logs mẫu

```
📩 [Kafka] Payment success event received: { bookingId: "bf5e9fb5-3556-4892-9c7d-15e7aaf27603", paymentId: "payment-uuid" }
✅ Booking bf5e9fb5-3556-4892-9c7d-15e7aaf27603 confirmed after payment success

📩 [Kafka] Payment failed event received: { bookingId: "bf5e9fb5-3556-4892-9c7d-15e7aaf27603", reason: "Insufficient funds" }
✅ Booking bf5e9fb5-3556-4892-9c7d-15e7aaf27603 canceled after payment failed

📩 [Kafka] Room deleted event received: { roomId: "room-uuid", buildingId: "building-uuid" }
✅ Canceled future booking booking-uuid for deleted room room-uuid
```

## ⚙️ Configuration

### **Kafka Topics (Chỉ những topic cần thiết):**
- `payment.success` - Nhận từ Payment Service
- `payment.failed` - Nhận từ Payment Service
- `payment.refunded` - Nhận từ Payment Service
- `room.deleted` - Nhận từ Room Service

### **Environment Variables:**
```env
KAFKA_BROKER=localhost:9092
KAFKA_CLIENT_ID=booking-service
KAFKA_GROUP_ID=booking-group
```

## 🚀 Benefits

1. **Automatic Status Updates:** Booking status được cập nhật tự động dựa trên payment
2. **Room Management:** Tự động cancel bookings khi room bị xóa
3. **Error Resilience:** Xử lý lỗi gracefully, không crash service
4. **Real-time:** Phản ứng ngay khi có events
5. **Consistency:** Đảm bảo booking status luôn đúng với payment status
6. **Minimal Overhead:** Chỉ nhận những event thực sự cần thiết
7. **Clean Architecture:** Không có circular dependency
8. **Performance:** Giảm số lượng event subscriptions

## 🔄 Integration với các Service khác

### **Booking Service → Other Services:**
- **`booking.created`** → Payment Service nhận → Tạo payment PENDING
- **`booking.canceled`** → Payment Service nhận → Cancel payment

### **Other Services → Booking Service:**
- **Payment Service** gửi `payment.success` → Booking Service nhận → Booking CONFIRMED
- **Payment Service** gửi `payment.failed` → Booking Service nhận → Booking CANCELED
- **Room Service** gửi `room.deleted` → Booking Service nhận → Cancel future bookings

## 🏗️ Architecture

### **Booking Service Role:**
```
┌─────────────────┐
│ Booking Service │
│                 │
│ ✅ CRUD Booking │
│ ✅ Send Events   │
│ ✅ Receive Events│
│ ✅ Update Status │
└─────────────────┘
         │
         ▼
┌─────────────────┐
│ Kafka Consumer  │
│                 │
│ payment.success │
│ payment.failed  │
│ payment.refunded│
│ room.deleted    │
└─────────────────┘
```

## 📊 Key Features

1. **Payment Integration:** Tự động cập nhật booking status dựa trên payment
2. **Room Management:** Tự động cancel bookings khi room bị xóa
3. **Status Validation:** Chỉ cho phép status transition hợp lệ
4. **Future Booking Protection:** Chỉ cancel bookings trong tương lai
5. **Error Handling:** Xử lý lỗi gracefully với detailed logging
