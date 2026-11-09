#!/bin/sh
# Local-only provisioning of the least-privilege runtime role. In Azure this is done by Bicep/admin automation.
set -eu
: "${CORE_APP_DB_PASSWORD:?CORE_APP_DB_PASSWORD must be set}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$CORE_APP_DB_PASSWORD" <<'SQL'
CREATE ROLE core_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'app_password';
GRANT CONNECT ON DATABASE core_studio TO core_app;
SQL
