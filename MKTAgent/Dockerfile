# MKTAgent — TS service run via tsx (no build step), Prisma client generated at build.
FROM node:20-bullseye-slim

WORKDIR /app

# Install deps first for layer caching.
COPY package.json ./
RUN npm install --no-audit --no-fund

# Prisma schema + generate client.
COPY prisma ./prisma
RUN npx prisma generate

# App source.
COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
ENV PORT=7100
EXPOSE 7100

# Apply migrations then start (compose ensures DB is up first).
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/server.ts"]
