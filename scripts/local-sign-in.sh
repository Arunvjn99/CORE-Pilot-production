#!/bin/sh
# Prints what to type into the LOCAL test login page (mock OIDC server) to sign in as the
# company admin from .env. Local development only: production uses Microsoft Entra ID.
set -eu
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
admin=$(echo "$BOOTSTRAP_PLATFORM_ADMIN_OBJECT_IDS" | cut -d, -f1)
if [ -z "$admin" ] || [ -z "$OIDC_ALLOWED_TENANT_ID" ]; then
  echo "BOOTSTRAP_PLATFORM_ADMIN_OBJECT_IDS and OIDC_ALLOWED_TENANT_ID must be set in .env" >&2
  exit 1
fi
cat <<MSG
Open http://localhost:${WEB_HOST_PORT:-8080} and choose "Sign in with Microsoft".
On the local test login page enter:

  username: $admin
  claims:   {"oid":"$admin","tid":"$OIDC_ALLOWED_TENANT_ID","name":"Company Admin"}

To sign in as someone else (e.g. a designer), use any new id as both username and "oid",
keep the same "tid", then add them to a team from Settings → Members as the admin.
MSG
