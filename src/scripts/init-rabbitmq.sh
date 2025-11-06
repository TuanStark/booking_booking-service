#!/bin/bash

# Variables from .env
RABBITMQ_HOST="localhost"
RABBITMQ_PORT="5672"
RABBITMQ_USER="guest"
RABBITMQ_PASS="guest"
EXCHANGE_NAME="booking_exchange"
QUEUE_NAME="booking_queue"
ROUTING_KEYS=("booking.created" "booking.canceled" "payment.request")

# Wait for RabbitMQ to be ready
echo "Waiting for RabbitMQ to start..."
until curl -s -u $RABBITMQ_USER:$RABBITMQ_PASS http://$RABBITMQ_HOST:$RABBITMQ_PORT/api/aliveness-test/%2F; do
  sleep 2
done
echo "RabbitMQ is up!"

# Create exchange
rabbitmqadmin -u $RABBITMQ_USER -p $RABBITMQ_PASS declare exchange name=$EXCHANGE_NAME type=direct durable=true

# Create queue
rabbitmqadmin -u $RABBITMQ_USER -p $RABBITMQ_PASS declare queue name=$QUEUE_NAME durable=true

# Bind queue to exchange with routing keys
for ROUTING_KEY in "${ROUTING_KEYS[@]}"; do
  rabbitmqadmin -u $RABBITMQ_USER -p $RABBITMQ_PASS declare binding source=$EXCHANGE_NAME destination=$QUEUE_NAME routing_key=$ROUTING_KEY
done

echo "RabbitMQ initialized: exchange=$EXCHANGE_NAME, queue=$QUEUE_NAME"