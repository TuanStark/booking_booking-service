export enum KafkaTopics {
    // Booking events
    BOOKING_CREATED = 'booking.created',
    BOOKING_CANCELED = 'booking.canceled',
    
    // Payment events
    PAYMENT_SUCCESS = 'payment.success',
    PAYMENT_FAILED = 'payment.failed',
    PAYMENT_REFUNDED = 'payment.refunded',
    
    // Room events
    ROOM_CREATED = 'room.created',
    ROOM_UPDATED = 'room.updated',
    ROOM_DELETED = 'room.deleted',
    
    // Building events
    BUILDING_CREATED = 'building.created',
    BUILDING_UPDATED = 'building.updated',
    BUILDING_DELETED = 'building.deleted',
    
    // User events
    USER_REGISTERED = 'user.registered',
    USER_UPDATED = 'user.updated',
    
    // Notification events
    NOTIFICATION_SENT = 'notification.sent',
    
    // Review events
    REVIEW_CREATED = 'review.created',
    REVIEW_UPDATED = 'review.updated',

    PAYMENT_STATUS_UPDATED = 'payment.status.updated',

  }
  