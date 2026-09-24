# syntax=docker/dockerfile:1
#
# The only image that carries ffmpeg. Debian bookworm ships ffmpeg 5.1, which
# has everything the ladder needs: the hls muxer with var_stream_map (one
# process, many renditions, one master playlist) and hls_key_info_file for
# AES-128 segment encryption.
#
# GPU=intel adds the Intel media driver and QSV runtimes, for h264_qsv /
# h264_vaapi on an Intel iGPU (see docker-compose.gpu-intel.yml). The
# non-free driver is the one with full H.264 encode support.

FROM node:24-bookworm-slim AS base
ARG GPU=none
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable \
 && if [ "$GPU" = "intel" ]; then \
      sed -i 's/^Components: main$/Components: main non-free non-free-firmware/' \
        /etc/apt/sources.list.d/debian.sources; \
    fi \
 && apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && if [ "$GPU" = "intel" ]; then \
      apt-get install -y --no-install-recommends \
        intel-media-va-driver-non-free libmfx1 libmfx-gen1.2 vainfo; \
    fi \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY infra/docker.npmrc .npmrc
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY apps/transcoder/package.json ./apps/transcoder/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store \
      --filter @stream/transcoder...

FROM deps AS build
COPY turbo.json ./
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY apps/transcoder ./apps/transcoder
RUN pnpm --filter @stream/shared run build \
 && pnpm --filter @stream/transcoder run build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/transcoder ./apps/transcoder

# Runs as root deliberately: it owns the shared /media volume that the edge
# mounts read-only, and Docker volumes are created root-owned. It listens on
# no ports and is unreachable from outside the compose network.
CMD ["node", "apps/transcoder/dist/main.js"]

