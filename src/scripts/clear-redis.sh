#!/bin/bash

# Variables from .env
REDIS_HOST="localhost"
REDIS_PORT="6379"
KEY_PATTERN="booking:*"

# Clear Redis keys matching pattern
redis-cli -h $REDIS_HOST -p $REDIS_PORT keys $KEY_PATTERN | xargs redis-cli -h $REDIS_HOST -p $REDIS_PORT del

echo "Cleared Redis keys matching $KEY_PATTERN"