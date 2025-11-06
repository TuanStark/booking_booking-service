#!/bin/bash

# Variables from .env
RABBITMQ_HOST="localhost"
RABBITMQ_PORT="5672"
RABBITMQ_USER="guest"
RABBITMQ_PASS="guest"
REDIS_HOST="localhost"
REDIS_PORT="6379"
POSTGRES_HOST="localhost"
POSTGRES_PORT="5432"
POSTGRES_USER="user"

# Check RabbitMQ
echo "Checking RabbitMQ connection..."
curl -s -u $RABBITMQ_USER:$RABBITMQ_PASS http://$RABBITMQ_HOST:$RABBITMQ_PORT/api/aliveness-test/%2F
if [ $? -eq 0 ]; then
  echo "RabbitMQ is up"
else
  echo "RabbitMQ connection failed"
  exit 1
fi

# Check Redis
echo "Checking Redis connection..."
redis-cli -h $REDIS_HOST -p $REDIS_PORT ping
if [ $? -eq 0 ]; then
  echo "Redis is up"
else
  echo "Redis connection failed"
  exit 1
fi

# Check PostgreSQL
echo "Checking PostgreSQL connection..."
pg_isready -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER
if [ $? -eq 0 ]; then
  echo "PostgreSQL is up"
else
  echo "PostgreSQL connection failed"
  exit 1
fi

echo "All connections are healthy"