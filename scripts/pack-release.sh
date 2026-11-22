#!/usr/bin/env bash
# Pack the Next.js standalone build for Ubuntu deploy to activists.miew.ru
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .next/standalone/server.js ]; then
  echo "missing .next/standalone/server.js — run: npm run build:server" >&2
  exit 1
fi

rm -rf release
mkdir -p release
cp -a .next/standalone/. release/

# Static assets must live next to the standalone server
mkdir -p release/.next
if [ -d .next/static ]; then
  cp -a .next/static release/.next/
fi
if [ -d public ]; then
  cp -a public release/public
fi

# Keep schema for remote-deploy compatibility (DB optional for localStorage app)
if [ -f deploy/schema.sql ]; then
  cp -a deploy/schema.sql release/schema.sql
fi

tar -czf release.tgz -C release .
echo "packed $(du -h release.tgz | awk '{print $1}') -> release.tgz"
