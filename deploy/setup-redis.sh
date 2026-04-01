#!/bin/bash
# Setup Redis di VM Apps (192.168.50.3) via Docker
# Jalankan script ini di VM Apps:
#   chmod +x setup-redis.sh && ./setup-redis.sh

set -e

echo "📦 Setting up Redis on VM Apps..."

# 1. Pull Redis image
docker pull redis:7-alpine

# 2. Create data directory
mkdir -p /opt/redis/data

# 3. Create Redis config
cat > /opt/redis/redis.conf << 'EOF'
# Redis Configuration for Payment Gateway
bind 0.0.0.0
port 6379

# Persistence
appendonly yes
appendfsync everysec
save 900 1
save 300 10
save 60 10000

# Memory
maxmemory 512mb
maxmemory-policy noeviction

# Security — set password (ganti dengan password yang kuat)
requirepass pg_redis_2026!

# Logging
loglevel notice

# Connection
timeout 300
tcp-keepalive 300
EOF

# 4. Run Redis container
docker run -d \
  --name redis-pg \
  --restart always \
  -p 6379:6379 \
  -v /opt/redis/data:/data \
  -v /opt/redis/redis.conf:/usr/local/etc/redis/redis.conf \
  redis:7-alpine redis-server /usr/local/etc/redis/redis.conf

# 5. Verify
echo ""
echo "⏳ Waiting for Redis to start..."
sleep 2

if docker exec redis-pg redis-cli -a pg_redis_2026! ping | grep -q PONG; then
  echo "✅ Redis is running!"
  echo ""
  echo "📋 Connection info:"
  echo "   Host: 192.168.50.3"
  echo "   Port: 6379"
  echo "   Pass: pg_redis_2026!"
  echo ""
  echo "   REDIS_URL=redis://:pg_redis_2026!@192.168.50.3:6379"
else
  echo "❌ Redis failed to start. Check: docker logs redis-pg"
fi
