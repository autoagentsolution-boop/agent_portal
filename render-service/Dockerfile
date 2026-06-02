FROM node:20-bullseye-slim AS base

# Chromium runtime libs required by Remotion + ffmpeg for encoding
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libxcomposite1 \
      libxdamage1 libxfixes3 libxrandr2 libgbm1 libxkbcommon0 libpango-1.0-0 \
      libcairo2 libasound2 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy db package first (render-service has @videofarm/db file: dep)
COPY db/package.json db/package-lock.json ./db/
COPY db/prisma ./db/prisma
COPY db/prisma.config.ts ./db/
COPY db/tsconfig.json ./db/
RUN cd db && npm ci --omit=dev

# Generate Prisma client into db/generated/
RUN cd db && npx prisma generate

# Install render-service deps with linked @videofarm/db
COPY render-service/package.json render-service/package-lock.json ./render-service/
RUN cd render-service && npm ci

# Copy source last so code changes don't bust the install cache
COPY render-service/tsconfig.json ./render-service/
COPY render-service/src ./render-service/src

WORKDIR /app/render-service

EXPOSE 7000
ENV NODE_ENV=production
ENV PORT=7000

CMD ["npx", "tsx", "src/server.ts"]
