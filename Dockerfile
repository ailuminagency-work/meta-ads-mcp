FROM node:22-alpine3.24 AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts

FROM node:22-alpine3.24 AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Sized for the 1 GB Railway container: about half for the V8 old generation,
# the rest for what lives outside it (Buffers and response bodies, the ffmpeg
# child of a video job, the runtime itself). V8 otherwise derives its limit from
# the memory it detects (2 GB on a large host), so an explicit cap keeps the
# limit known and makes an overrun a V8 heap error rather than a kernel OOM kill.
# A larger container overrides this with a NODE_OPTIONS variable (the Cloud Run
# deploy sets 1536 for 2 GiB).
ENV NODE_OPTIONS=--max-old-space-size=512
# dns.lookup, fs, crypto and zlib share libuv's pool of 4 threads, and a hostile
# name server can hold a getaddrinfo thread for tens of seconds (image_url on
# ads_upload_ad_image resolves caller-chosen names). 8 threads keep file and
# crypto work moving while a few lookups stall; idle threads cost nothing.
ENV UV_THREADPOOL_SIZE=8

# ffmpeg + ffprobe for keyframe extraction / compact video transcodes (ads_get_video_media).
RUN apk add --no-cache ffmpeg

COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/node_modules/ node_modules/
COPY package.json ./
# The skills ship with the server: they are published as MCP resources at runtime.
COPY skills/ skills/

EXPOSE 3000

# Liveness only: /health never touches Firestore (see docs/release/health-and-readiness.md).
# 127.0.0.1, not localhost: the credential-waiting server listens on IPv4 only.
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

USER node
CMD ["node", "dist/index.js"]
