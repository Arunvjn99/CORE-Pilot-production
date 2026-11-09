# syntax=docker/dockerfile:1.7
# Production image for apps/api (also used for the one-off migration job). Built identically in CI and locally.
ARG NODE_IMAGE=node:24.22.2-alpine3.24

FROM ${NODE_IMAGE} AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --offline --filter @core-studio/api... \
 && pnpm --filter @core-studio/contracts run build \
 && pnpm --filter @core-studio/api run build \
 && pnpm --filter @core-studio/api deploy --prod --legacy /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
# Patch OS packages and remove package-manager tooling the runtime never uses (reduces attack surface and CVEs).
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/v1/health/live >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "--import", "./dist/instrumentation.js", "dist/main.js"]
