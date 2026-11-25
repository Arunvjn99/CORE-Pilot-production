#!/usr/bin/env bash
# One command to run CORE AI Design Studio locally: ./scripts/up.sh
#   - pulls the latest main (only when the working tree is clean; --no-pull skips it)
#   - starts Docker Desktop on macOS if it is not running
#   - creates .env on first run
#   - moves the API to a free port if 3000 is taken
#   - builds and starts every service, waits until healthy, opens the browser
set -euo pipefail
cd "$(dirname "$0")/.."

pull=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) pull=0 ;;
    -h | --help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

say() { printf '\n==> %s\n' "$*"; }

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

set_env() { # set_env KEY VALUE (portable in-place edit)
  if grep -q "^$1=" .env; then
    sed -i.bak "s#^$1=.*#$1=$2#" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$1" "$2" >>.env
  fi
}

env_value() { grep "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }

# 1. Latest code
if [ "$pull" = 1 ]; then
  if [ -z "$(git status --porcelain)" ]; then
    say "Pulling the latest code"
    git pull --ff-only || echo "Could not pull (continuing with the code you have)."
  else
    say "You have local changes, so the latest code was not pulled"
  fi
fi

# 2. Docker
if ! docker info >/dev/null 2>&1; then
  if [ "$(uname)" = Darwin ]; then
    say "Starting Docker Desktop"
    open -a Docker
    for _ in $(seq 1 90); do
      docker info >/dev/null 2>&1 && break
      sleep 2
    done
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is not running. Start Docker Desktop, then run this again." >&2
    exit 1
  fi
fi

# 3. Settings (.env) on first run
# Read the name from the compose file: `docker compose config` fails before .env exists.
project=$(sed -n 's/^name: *//p' docker-compose.yml | head -1 || true)
project=${project:-$(basename "$PWD" | tr 'A-Z' 'a-z')}
if [ ! -f .env ]; then
  # A database volume left from an earlier setup has other passwords than a new .env would.
  if docker volume ls -q | grep -qx "${project}_pgdata"; then
    cat >&2 <<MSG
There is no .env, but a database from an earlier setup still exists, and its passwords
would not match new settings. To start fresh (this deletes the old local data):
  docker compose down -v && ./scripts/up.sh
MSG
    exit 1
  fi
  say "Creating local settings (.env)"
  ./scripts/init-local-env.sh
fi

# 4. Ports (skipped when the app is already running, since then it holds them itself)
if [ -z "$(docker compose ps -q --status running 2>/dev/null)" ]; then
  api_port=$(env_value API_HOST_PORT)
  api_port=${api_port:-3000}
  if port_busy "$api_port"; then
    for candidate in $(seq 3001 3020); do
      if ! port_busy "$candidate"; then
        say "Port $api_port is in use; the API will use $candidate"
        set_env API_HOST_PORT "$candidate"
        break
      fi
    done
  fi
  web_port=$(env_value WEB_HOST_PORT)
  preview_port=$(env_value PREVIEW_HOST_PORT)
  for port in "${web_port:-8080}" "${preview_port:-8090}" 5432 6379 8180; do
    if port_busy "$port"; then
      echo "Port $port is used by another program. Close it (find it with: lsof -i :$port), then run this again." >&2
      exit 1
    fi
  done
fi

# 5. Build and start
say "Building and starting (the first run takes a few minutes)"
# Downloads from Docker Hub can time out (a network hiccup, or Docker Desktop just started):
# download and build up to 3 times before giving up.
ready=0
for attempt in 1 2 3; do
  if docker compose pull --ignore-buildable --quiet && docker compose build; then
    ready=1
    break
  fi
  if [ "$attempt" -lt 3 ]; then
    say "A download failed (attempt $attempt of 3); retrying in 10 seconds"
    sleep 10
  fi
done
if [ "$ready" = 0 ]; then
  cat >&2 <<MSG

Docker could not download what it needs from the internet after 3 attempts.
Check your internet connection. On a company network or VPN, Docker Desktop may need the
proxy set in Settings → Resources → Proxies. Then run this again.
MSG
  exit 1
fi
if ! docker compose up -d --wait; then
  echo >&2
  docker compose ps -a >&2
  echo "Something did not start. Send the output of: docker compose logs --tail 50" >&2
  exit 1
fi

web_port=$(env_value WEB_HOST_PORT)
url="http://localhost:${web_port:-8080}"
say "Running at $url"
./scripts/local-sign-in.sh || true
if [ "$(uname)" = Darwin ]; then open "$url"; fi
echo
echo "Stop it with: docker compose stop   (your data is kept)"
