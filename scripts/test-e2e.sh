#!/bin/sh
# Runs Playwright E2E against the composed stack (http://localhost:${WEB_HOST_PORT:-8080}) using identity settings from .env.
set -eu
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
export E2E_BASE_URL="http://localhost:${WEB_HOST_PORT:-8080}"
export E2E_TENANT_ID="$OIDC_ALLOWED_TENANT_ID"
export E2E_ADMIN_OID="$(echo "$BOOTSTRAP_PLATFORM_ADMIN_OBJECT_IDS" | cut -d, -f1)"
exec corepack pnpm --filter @core-studio/web exec playwright test "$@"
