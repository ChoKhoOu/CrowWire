FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN addgroup -S crowwire && adduser -S crowwire -G crowwire
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist/ ./dist/
COPY feeds.yaml ./
COPY targets.yaml ./
COPY filters.yaml ./
RUN mkdir -p /app/data && chown -R crowwire:crowwire /app
VOLUME /app/data
USER crowwire
CMD ["node", "dist/daemon.js"]
