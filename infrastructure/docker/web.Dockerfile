# syntax=docker/dockerfile:1.7
# Static SPA served by unprivileged nginx. The API is reverse-proxied same-origin, so no URL is baked into the bundle.
ARG NODE_IMAGE=node:24.22.2-alpine3.24

FROM ${NODE_IMAGE} AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --offline --filter @core-studio/web... \
 && pnpm --filter @core-studio/contracts run build \
 && pnpm --filter @core-studio/web exec vite build

FROM nginxinc/nginx-unprivileged:1.31.7-alpine3.24 AS runtime
USER root
# curl is unused at runtime; patch remaining OS packages.
RUN apk upgrade --no-cache && apk del --no-cache curl
USER 101
COPY infrastructure/docker/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# Only API_UPSTREAM is substituted; nginx's own $variables are left intact.
ENV NGINX_ENVSUBST_FILTER=^API_UPSTREAM$
EXPOSE 8080
