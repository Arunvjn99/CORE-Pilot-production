# syntax=docker/dockerfile:1.7
# Preview runtime (separate origin). Static files only; screen code is compiled and run in the browser.
ARG NODE_IMAGE=node:24.22.2-alpine3.24

FROM ${NODE_IMAGE} AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --offline --filter @core-studio/preview... \
 && pnpm --filter @core-studio/contracts run build \
 && pnpm --filter @core-studio/preview exec vite build \
 && rm -f apps/preview/dist/config.json

FROM nginxinc/nginx-unprivileged:1.31.7-alpine3.24 AS runtime
USER root
RUN apk upgrade --no-cache && apk del --no-cache curl
USER 101
COPY infrastructure/docker/preview/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/preview/dist /usr/share/nginx/html
ENV NGINX_ENVSUBST_FILTER=^STUDIO_ORIGIN$
EXPOSE 8090
