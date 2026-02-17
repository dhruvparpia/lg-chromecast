FROM node:22-slim AS deps
WORKDIR /app
COPY cast-bridge/package.json cast-bridge/package-lock.json ./
RUN npm ci --production

FROM node:22-slim
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY cast-bridge/ ./
RUN npm install tsx
ENV DEVICE_NAME="Cast Bridge"
EXPOSE 8008 8009 8010
CMD ["npx", "tsx", "src/index.ts"]
