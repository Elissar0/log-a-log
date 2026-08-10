# Keep the Bun release explicit so local, CI, and image builds are reproducible.
FROM oven/bun:1.2.22 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY src/db/migrations ./migrations
RUN bun run build

# Runtime dependencies are installed separately so development tooling is not shipped.
FROM oven/bun:1.2.22 AS runtime-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

FROM oven/bun:1.2.22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    AUTH_ENABLED=false \
    MIGRATIONS_DIR=/app/migrations

COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/bun.lock ./bun.lock
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
# Migration is intentionally a small Bun CLI rather than part of the server bundle.
COPY --from=build /app/src/config.ts ./src/config.ts
COPY --from=build /app/src/db/pool.ts ./src/db/pool.ts
COPY --from=build /app/src/db/migrate.ts ./src/db/migrate.ts
COPY --from=build /app/src/db/migrate-cli.ts ./src/db/migrate-cli.ts
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chown -R bun:bun /app && chmod 0555 /app/docker-entrypoint.sh
USER bun
EXPOSE 8080
ENTRYPOINT ["/app/docker-entrypoint.sh"]
