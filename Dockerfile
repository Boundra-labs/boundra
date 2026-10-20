# Hosts that build only the last stage (Render) choose the image with this build argument:
# web, api, worker, migrate or all. Compose and the release workflow pick a target instead.
ARG BOUNDRA_SERVICE=web

FROM node:22.22.0-bookworm-slim AS base
ENV COREPACK_HOME=/opt/corepack
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/mcp/package.json ./apps/mcp/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/chain/package.json ./packages/chain/package.json
COPY packages/acce/package.json ./packages/acce/package.json
COPY packages/llm/package.json ./packages/llm/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
COPY contracts/package.json ./contracts/package.json
COPY evaluation/package.json ./evaluation/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN pnpm --filter @boundra/api deploy --legacy --prod /out/api \
    && pnpm --filter @boundra/worker deploy --legacy --prod /out/worker

FROM build AS migrate
# Reviewed deployment manifests at the path Compose mounts them, for hosts without that volume.
RUN mkdir -p /config && cp -r deploy/manifests /config/manifests
USER node
CMD ["pnpm", "db:migrate"]

FROM base AS api
# Release identifier (e.g. git describe); set last so changing it never invalidates the build.
ARG RELEASE=dev
ENV BOUNDRA_RELEASE=$RELEASE
LABEL org.opencontainers.image.version=$RELEASE
ENV NODE_ENV=production
COPY --from=build --chown=node:node /out/api /app
COPY --from=build /app/deploy/manifests /config/manifests
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]

FROM base AS worker
# Release identifier (e.g. git describe); set last so changing it never invalidates the build.
ARG RELEASE=dev
ENV BOUNDRA_RELEASE=$RELEASE
LABEL org.opencontainers.image.version=$RELEASE
ENV NODE_ENV=production
COPY --from=build --chown=node:node /out/worker /app
COPY --from=build /app/deploy/manifests /config/manifests
USER node
CMD ["node", "dist/main.js"]

FROM base AS web
# Release identifier (e.g. git describe); set last so changing it never invalidates the build.
ARG RELEASE=dev
ENV BOUNDRA_RELEASE=$RELEASE
LABEL org.opencontainers.image.version=$RELEASE
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/apps/web/.next/standalone /app
COPY --from=build --chown=node:node /app/apps/web/.next/static /app/apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# API, worker and web app in one container, for a single free host (deploy/render-free.sh).
FROM migrate AS all
USER root
RUN cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
USER node
# Release identifier (e.g. git describe); set last so changing it never invalidates the build.
ARG RELEASE=dev
ENV BOUNDRA_RELEASE=$RELEASE
ENV NODE_ENV=production
CMD ["bash", "deploy/render-free.sh"]

FROM ${BOUNDRA_SERVICE} AS selected
