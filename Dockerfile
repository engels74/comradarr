# Base stage with Bun runtime
FROM oven/bun:1-alpine AS base
WORKDIR /app

# Dependencies stage - install with BuildKit cache
FROM base AS deps
COPY package.json bun.lock ./
RUN --mount=type=cache,id=bun,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# Build stage - compile the application
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN bun run build

# Production stage - minimal runtime image
FROM base AS production
ENV NODE_ENV=production

# Copy production dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy built application
COPY --from=build /app/build ./build

# Copy drizzle migrations for database setup
COPY --from=build /app/drizzle ./drizzle

# Copy package.json for runtime
COPY --from=build /app/package.json ./

# Run as non-root user (bun user exists in oven/bun images)
USER bun

EXPOSE 3000

# Health check using wget (available in alpine)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["bun", "./build/index.js"]
