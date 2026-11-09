#!/bin/sh
# Creates .env from .env.example with freshly generated local secrets. Refuses to overwrite an existing .env.
set -eu
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  echo ".env already exists; leaving it unchanged." >&2
  exit 0
fi
cp .env.example .env
for key in POSTGRES_ADMIN_PASSWORD CORE_APP_DB_PASSWORD REDIS_PASSWORD; do
  value=$(openssl rand -hex 24)
  sed -i.bak "s/^${key}=\$/${key}=${value}/" .env
done
rm -f .env.bak
chmod 600 .env
echo "Created .env with generated local secrets."
