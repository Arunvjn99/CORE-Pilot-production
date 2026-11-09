#!/bin/sh
# Runs API integration tests against the local compose Postgres/Redis using credentials from .env.
set -eu
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
export TEST_ADMIN_DATABASE_URL="postgres://${POSTGRES_ADMIN_USER}:${POSTGRES_ADMIN_PASSWORD}@localhost:5432/core_studio"
export TEST_DATABASE_URL="postgres://core_app:${CORE_APP_DB_PASSWORD}@localhost:5432/core_studio"
export TEST_OIDC_ISSUER_URL="http://localhost:8180/default"
export TEST_REDIS_URL="redis://:${REDIS_PASSWORD}@localhost:6379/15"
exec corepack pnpm --filter @core-studio/api run test:integration
