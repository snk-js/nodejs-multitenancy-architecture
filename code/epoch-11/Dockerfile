# ---- build stage: dev deps allowed here, never shipped ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Typecheck gates the image; integration tests run in CI where Postgres/Redis
# service containers exist (see .github/workflows/ci.yml).
RUN npm run typecheck

# ---- runtime stage: only what serving needs ----
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/src ./src
COPY --from=build /app/public ./public
COPY --from=build /app/migrations ./migrations

# 🛡️ never run as root: an RCE lands as an unprivileged user
USER node
EXPOSE 3000
CMD ["node", "--import", "./src/otel.ts", "src/server.ts"]
