#!/bin/sh
# Creates .env from .env.example with freshly generated local secrets. Refuses to overwrite an existing .env.
set -eu
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  echo ".env already exists; leaving it unchanged." >&2
  exit 0
fi
cp .env.example .env
for key in POSTGRES_ADMIN_PASSWORD CORE_APP_DB_PASSWORD REDIS_PASSWORD OIDC_CLIENT_SECRET; do
  value=$(openssl rand -hex 24)
  sed -i.bak "s/^${key}=\$/${key}=${value}/" .env
done
new_uuid() { cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr 'A-Z' 'a-z'; }
tenant=$(new_uuid)
admin=$(new_uuid)
sed -i.bak "s/^OIDC_ALLOWED_TENANT_ID=\$/OIDC_ALLOWED_TENANT_ID=${tenant}/; s/^BOOTSTRAP_PLATFORM_ADMIN_OBJECT_IDS=\$/BOOTSTRAP_PLATFORM_ADMIN_OBJECT_IDS=${admin}/" .env
kek=$(openssl rand -base64 32)
sed -i.bak "s#^LOCAL_KEK=\$#LOCAL_KEK=${kek}#" .env
rm -f .env.bak
chmod 600 .env
echo "Created .env with generated local secrets."
