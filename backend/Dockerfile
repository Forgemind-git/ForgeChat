FROM node:20-alpine

# ffmpeg for transcoding WhatsApp voice notes (Ogg/Opus → MP3) so Safari can play them
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Build context is the repo ROOT (see docker-compose.yml: context: .) so the
# boot-time migration runner can copy db/migrations into the image.
COPY backend/package.json ./
RUN npm install --omit=dev

COPY backend/src/ ./src/
COPY backend/scripts/ ./scripts/
COPY db/migrations/ ./db/migrations/

ENV NODE_ENV=production
EXPOSE 3011

CMD ["node", "src/index.js"]
