# syntax=docker/dockerfile:1
#
# Build context is the repository root:
#   docker build -f infra/api.Dockerfile .
#
# Debian slim rather than Alpine: Prisma's query engine and @node-rs/argon2
# both ship glibc builds that work out of the box, which is worth ~40 MB.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Manifests only, so a source-only change does not invalidate the install layer.
FROM base AS deps
COPY infra/docker.npmrc .npmrc
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store \
      --filter @stream/api... --filter @stream/db...

FROM deps AS build
COPY turbo.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @stream/shared run build \
 && pnpm --filter @stream/db run build \
 && pnpm --filter @stream/api run build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api
COPY infra/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh
RUN chmod +x /usr/local/bin/api-entrypoint.sh

USER node
EXPOSE 4000
ENTRYPOINT ["/usr/local/bin/api-entrypoint.sh"]
CMD ["node", "apps/api/dist/server.js"]

