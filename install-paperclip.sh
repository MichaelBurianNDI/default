#!/usr/bin/env bash
# Install and run Paperclip AI - open-source orchestration for AI agent teams
# https://github.com/paperclipai/paperclip
#
# Prerequisites: Node.js 20+, pnpm 9.15+, PostgreSQL 16+

set -euo pipefail

PAPERCLIP_DIR="${PAPERCLIP_DIR:-/home/user/paperclip}"
DB_USER="${PAPERCLIP_DB_USER:-paperclip}"
DB_PASS="${PAPERCLIP_DB_PASS:-paperclip}"
DB_NAME="${PAPERCLIP_DB_NAME:-paperclip}"
DB_HOST="${PAPERCLIP_DB_HOST:-127.0.0.1}"
DB_PORT="${PAPERCLIP_DB_PORT:-5432}"

echo "==> Cloning Paperclip..."
if [ ! -d "$PAPERCLIP_DIR" ]; then
  git clone https://github.com/paperclipai/paperclip.git "$PAPERCLIP_DIR"
fi

echo "==> Installing dependencies..."
cd "$PAPERCLIP_DIR"
pnpm install

echo "==> Building project..."
pnpm build

echo "==> Setting up PostgreSQL database..."
pg_ctlcluster 16 main start 2>/dev/null || true
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS' SUPERUSER;"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

echo "==> Running onboarding..."
npx paperclipai onboard --yes 2>/dev/null || true

export DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

echo "==> Starting Paperclip server..."
echo "    UI:  http://127.0.0.1:3100"
echo "    API: http://127.0.0.1:3100/api"

exec "$PAPERCLIP_DIR/server/node_modules/.bin/tsx" "$PAPERCLIP_DIR/server/src/index.ts"
