# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --filter @stream/web...

FROM deps AS build
COPY turbo.json ./
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

# Baked into the client bundle at build time. Everything is same-origin, so
# this is only needed for absolute links in metadata.
ARG NEXT_PUBLIC_BASE_URL=http://localhost:8080
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @stream/shared run build \
 && pnpm --filter @stream/web run build

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/web ./apps/web

USER node
EXPOSE 3000
WORKDIR /app/apps/web
# pnpm links a workspace package's binaries into that package's own
# node_modules/.bin, not the root one.
CMD ["node_modules/.bin/next", "start", "--port", "3000", "--hostname", "0.0.0.0"]
