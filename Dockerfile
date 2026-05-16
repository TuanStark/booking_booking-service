# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --legacy-peer-deps

COPY . .
RUN npx prisma generate && npm run build

FROM node:20-alpine AS pruner
WORKDIR /app

COPY package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

FROM node:20-alpine AS production
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

COPY --from=pruner --chown=nestjs:nodejs /app/package*.json ./
COPY --from=pruner --chown=nestjs:nodejs /app/dist ./dist
COPY --from=pruner --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=pruner --chown=nestjs:nodejs /app/node_modules ./node_modules

USER nestjs

ENV NODE_ENV=production \
    PORT=3005

EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main"]
