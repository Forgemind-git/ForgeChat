FROM node:20-alpine

# ffmpeg for transcoding WhatsApp voice notes (Ogg/Opus → MP3) so Safari can play them
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/
COPY scripts/ ./scripts/

ENV NODE_ENV=production
EXPOSE 3003

CMD ["node", "src/index.js"]
