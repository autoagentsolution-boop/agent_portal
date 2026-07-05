# MKTAgent — TS service run via tsx (no build step), Prisma client generated at build.
FROM node:20-bullseye-slim

WORKDIR /app

# ffmpeg: the video agent stitches Veo i2v clips into one mp4 (src/video/stitch.ts).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Install deps first for layer caching.
COPY package.json ./
RUN npm install --no-audit --no-fund

# Prisma schema + generate client.
COPY prisma ./prisma
RUN npx prisma generate

# App source. prisma.config.ts is REQUIRED at runtime: Prisma 7 reads the
# datasource url from it (schema.prisma has no inline url), so `migrate deploy`
# inside the container crash-loops without it.
COPY tsconfig.json prisma.config.ts ./
COPY src ./src

ENV NODE_ENV=production
ENV PORT=7100
EXPOSE 7100

# Apply migrations then start (compose ensures DB is up first).
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/server.ts"]
