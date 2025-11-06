# 🔄 Flow & Cơ Chế Hoạt Động - Get All Bookings với User & Room

## 📋 Tổng Quan

Khi client gọi `GET /bookings`, hệ thống sẽ:
1. Lấy bookings từ database
2. Enrich (làm giàu) data bằng cách lấy thêm user và room từ các service khác
3. Trả về kết quả đầy đủ

---

## 🎯 Flow Diagram

```
┌─────────────┐
│   Client    │
│  GET /bookings
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────┐
│  BookingController.findAll()        │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  BookingService.findAll()           │
│  ┌───────────────────────────────┐  │
│  │ 1. Query bookings từ DB        │  │
│  │    - Pagination               │  │
│  │    - Filtering                │  │
│  │    - Sorting                   │  │
│  └───────────────────────────────┘  │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  enrichBookingsWithExternalData()   │
│  ┌───────────────────────────────┐  │
│  │ 2. Collect userIds & roomIds  │  │
│  │    - Deduplicate               │  │
│  └───────────────────────────────┘  │
└──────┬──────────────────────────────┘
       │
       ├──────────────────────────┬─────────────────────────┐
       ▼                          ▼                         ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ getUsersByIds()  │    │ getRoomsByIds() │    │   (Parallel)    │
└────────┬────────┘    └────────┬────────┘    └─────────────────┘
         │                      │
         ▼                      ▼
┌───────────────────────────────┐
│  STEP 1: Check Redis Cache     │
│  ┌───────────────────────────┐│
│  │ user:123 → cache hit ✅    ││
│  │ user:456 → cache miss ❌   ││
│  │ room:789 → cache miss ❌   ││
│  └───────────────────────────┘│
└────────┬──────────────────────┘
         │
         ▼
┌───────────────────────────────┐
│  STEP 2: Fetch từ Services    │
│  (Parallel HTTP Requests)     │
│  ┌──────────────────────────┐│
│  │ GET /user/456             ││
│  │ GET /rooms/789            ││
│  └──────────────────────────┘│
└────────┬──────────────────────┘
         │
         ▼
┌───────────────────────────────┐
│  STEP 3: Cache Results        │
│  ┌──────────────────────────┐│
│  │ Redis.set(user:456)      ││
│  │ Redis.set(room:789)      ││
│  │ TTL: 3600s (1 hour)      ││
│  └──────────────────────────┘│
└────────┬──────────────────────┘
         │
         ▼
┌───────────────────────────────┐
│  STEP 4: Map Data vào Bookings│
│  ┌──────────────────────────┐│
│  │ booking.user = userData   ││
│  │ detail.room = roomData    ││
│  └──────────────────────────┘│
└────────┬──────────────────────┘
         │
         ▼
┌───────────────────────────────┐
│  Return Enriched Bookings      │
└───────────────────────────────┘
```

---

## 🔍 Chi Tiết Từng Bước

### **Bước 1: BookingService.findAll() - Lấy Bookings**

```typescript
// Input: query params (page, limit, search, sortBy, sortOrder)
// Output: bookings từ database

const [bookings, total] = await Promise.all([
  prisma.booking.findMany({
    where: { /* filter */ },
    orderBy: { /* sort */ },
    skip: (page - 1) * limit,
    take: limit,
    include: { details: true }
  }),
  prisma.booking.count()
]);
```

**Kết quả:**
```json
[
  {
    "id": "booking-1",
    "userId": "user-123",
    "status": "CONFIRMED",
    "details": [
      { "roomId": "room-789", "price": 100 },
      { "roomId": "room-456", "price": 200 }
    ]
  },
  {
    "id": "booking-2",
    "userId": "user-123",  // ← Trùng user
    "status": "PENDING",
    "details": [
      { "roomId": "room-789" }  // ← Trùng room
    ]
  }
]
```

---

### **Bước 2: enrichBookingsWithExternalData() - Collect IDs**

```typescript
// Thu thập tất cả userId và roomId từ bookings
const userIds: string[] = [];
const roomIds: string[] = [];

bookings.forEach((booking) => {
  if (booking.userId && !userIds.includes(booking.userId)) {
    userIds.push(booking.userId);  // Deduplicate
  }
  booking.details?.forEach((detail) => {
    if (detail.roomId && !roomIds.includes(detail.roomId)) {
      roomIds.push(detail.roomId);  // Deduplicate
    }
  });
});
```

**Kết quả sau deduplicate:**
```
userIds = ["user-123"]      // 2 bookings cùng user, chỉ lấy 1 lần
roomIds = ["room-789", "room-456"]  // Trùng room-789, chỉ lấy 1 lần
```

**Tại sao deduplicate?**
- Tránh fetch duplicate data
- Giảm số lượng HTTP requests
- Tối ưu performance

---

### **Bước 3: ExternalService.getUsersByIds() - Lấy Users**

#### **3.1. Check Redis Cache**

```typescript
// Parallel check cache cho tất cả user IDs
await Promise.all(
  uniqueIds.map(async (id) => {
    const cacheKey = `user:${id}`;
    const cached = await redisService.get(cacheKey);
    if (cached) {
      result.set(id, cached);  // ✅ Cache hit
    } else {
      idsToFetch.push(id);     // ❌ Cache miss
    }
  })
);
```

**Ví dụ:**
- `user:123` → Cache hit ✅ → Không cần fetch
- `user:456` → Cache miss ❌ → Cần fetch

#### **3.2. Fetch từ Auth Service (Parallel)**

```typescript
// Gọi parallel requests cho các user chưa có trong cache
const fetchPromises = idsToFetch.map((id) =>
  this.fetchUserById(id).catch((error) => {
    // Error handling - không crash toàn bộ
    return null;
  })
);

const users = await Promise.all(fetchPromises);
```

**Flow HTTP Request:**
```
┌─────────────────┐         ┌─────────────────┐
│ Booking Service  │────────▶│  Auth Service  │
│                 │  GET     │   /user/456     │
│                 │◀─────────│                 │
└─────────────────┘  {data}  └─────────────────┘
```

**Timeout:** 5 giây - Nếu service không respond trong 5s, hủy request

#### **3.3. Cache Results**

```typescript
users.map(async (user, index) => {
  if (user) {
    const id = idsToFetch[index];
    result.set(id, user);
    await redisService.set(
      `user:${id}`,
      user,
      3600  // TTL: 1 hour
    );
  }
});
```

**Redis Storage:**
```
Key: user:456
Value: { id: "456", email: "...", firstName: "...", ... }
TTL: 3600 seconds
```

**Lần request sau:**
- `user:456` → Cache hit ✅ → Không cần gọi HTTP request nữa!

---

### **Bước 4: ExternalService.getRoomsByIds() - Lấy Rooms**

Cơ chế hoàn toàn tương tự như `getUsersByIds()`:

1. ✅ Check cache trước
2. ✅ Parallel fetch những room chưa có
3. ✅ Cache kết quả

**Flow tương tự:**
```
┌─────────────────┐         ┌─────────────────┐
│ Booking Service │────────▶│  Room Service   │
│                 │  GET    │  /rooms/789     │
│                 │◀────────│  /rooms/456     │
└─────────────────┘         └─────────────────┘
```

---

### **Bước 5: Map Data vào Bookings**

```typescript
// Kết hợp user và room data vào bookings
return bookings.map((booking) => ({
  ...booking,
  user: usersMap.get(booking.userId) || null,  // Thêm user info
  details: booking.details?.map((detail) => ({
    ...detail,
    room: roomsMap.get(detail.roomId) || null   // Thêm room info
  }))
}));
```

**Kết quả cuối cùng:**
```json
{
  "data": [
    {
      "id": "booking-1",
      "userId": "user-123",
      "status": "CONFIRMED",
      "user": {                    // ← Được thêm vào
        "id": "user-123",
        "email": "john@example.com",
        "firstName": "John",
        "lastName": "Doe"
      },
      "details": [
        {
          "roomId": "room-789",
          "price": 100,
          "room": {                // ← Được thêm vào
            "id": "room-789",
            "name": "Deluxe Room",
            "price": 150,
            "capacity": 2,
            "images": [...]
          }
        }
      ]
    }
  ]
}
```

---

## ⚡ Cơ Chế Tối Ưu

### **1. Parallel Execution (Song Song)**

```typescript
// ❌ KHÔNG TỐI ƯU - Sequential (tuần tự)
const users = await getUsersByIds([...]);  // Chờ 2s
const rooms = await getRoomsByIds([...]);  // Chờ 3s
// Tổng: 5s

// ✅ TỐI ƯU - Parallel (song song)
const [users, rooms] = await Promise.all([
  getUsersByIds([...]),  // 2s
  getRoomsByIds([...])  // 3s
]);
// Tổng: 3s (lấy giá trị lớn nhất)
```

### **2. Redis Caching Layer**

**Cache Strategy:**
- **Cache-Aside Pattern**: Check cache → Nếu miss → Fetch → Cache lại
- **TTL (Time To Live)**: 1 giờ (3600s)
- **Key Pattern**: `user:{id}`, `room:{id}`

**Lợi ích:**
- Giảm số lượng HTTP requests
- Tăng tốc độ response
- Giảm load cho auth-service và room-service

**Ví dụ:**
```
Request 1: GET /bookings
  → Fetch user:123 từ auth-service (200ms)
  → Cache user:123 vào Redis

Request 2: GET /bookings (sau 10 phút)
  → user:123 từ Redis (5ms) ✅
  → Không cần gọi auth-service!
```

### **3. Deduplication**

```typescript
// Input: ["user-1", "user-1", "user-2", "user-1"]
// Output: ["user-1", "user-2"]

const uniqueIds = [...new Set(userIds.filter(id => id))];
```

**Lợi ích:**
- Tránh fetch duplicate data
- Giảm số lượng requests
- Tối ưu cache hits

### **4. Error Resilience**

```typescript
const fetchPromises = idsToFetch.map((id) =>
  this.fetchUserById(id).catch((error) => {
    // Nếu 1 user fail, không crash toàn bộ
    logger.warn(`Failed to fetch user ${id}`);
    return null;  // Return null thay vì throw error
  })
);
```

**Kết quả:**
- Nếu 1 user/room không fetch được → Return `null` cho user/room đó
- Các user/room khác vẫn được fetch thành công
- Booking vẫn được trả về (user/room = null)

---

## 📊 Performance Comparison

### **Scenario: 10 bookings, 5 unique users, 8 unique rooms**

#### **❌ KHÔNG TỐI ƯU (Sequential, No Cache)**
```
- Fetch 5 users: 5 × 200ms = 1000ms
- Fetch 8 rooms: 8 × 200ms = 1600ms
- Total: 2600ms (2.6 giây)
```

#### **✅ TỐI ƯU (Parallel + Cache + Deduplication)**
```
- Check cache (parallel): 5ms
- Fetch 5 users (parallel): 200ms (lấy max)
- Fetch 8 rooms (parallel): 200ms (lấy max)
- Total: ~405ms (0.4 giây)
```

**Tăng tốc: 6.4x! 🚀**

---

## 🔄 Cache Invalidation

Khi user hoặc room được update ở service khác:

```typescript
// Invalid cache manually
await externalService.invalidateUserCache('user-123');
await externalService.invalidateRoomCache('room-789');
```

**Hoặc đợi TTL expire** (sau 1 giờ tự động expire)

---

## 🎯 Tóm Tắt

1. **Query bookings** từ database
2. **Collect & deduplicate** userIds và roomIds
3. **Check Redis cache** → Lấy những cái có sẵn
4. **Parallel fetch** những cái chưa có từ services
5. **Cache results** vào Redis
6. **Map data** vào bookings
7. **Return** enriched bookings

**Kết quả:** Fast, efficient, scalable! ✨

