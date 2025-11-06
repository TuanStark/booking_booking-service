#!/bin/bash

# Variables from .env
POSTGRES_USER="user"
POSTGRES_PASSWORD="pass"
POSTGRES_HOST="localhost"
POSTGRES_PORT="5432"
POSTGRES_DB="booking_db"
REDIS_HOST="localhost"
REDIS_PORT="6379"
RABBITMQ_HOST="localhost"
RABBITMQ_PORT="5672"
RABBITMQ_USER="guest"
RABBITMQ_PASS="guest"
QUEUE_NAME="booking_queue"

# Reset database
psql -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER -c "DROP DATABASE $POSTGRES_DB;"
psql -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER -c "CREATE DATABASE $POSTGRES_DB;"
npx prisma migrate deploy
echo "Database $POSTGRES_DB reset"

# Clear Redis
redis-cli -h $REDIS_HOST -p $REDIS_PORT keys "booking:*" | xargs redis-cli -h $REDIS_HOST -p $REDIS_PORT del
echo "Redis cache cleared"

# Delete RabbitMQ queue
rabbitmqadmin -u $RABBITMQ_USER -p $RABBITMQ_PASS delete queue name=$QUEUE_NAME
rabbitmqadmin -u $RABBITMQ_USER -p $RABBITMQ_PASS declare queue name=$QUEUE_NAME durable=true
echo "RabbitMQ queue $QUEUE_NAME reset"

echo "Environment reset complete"