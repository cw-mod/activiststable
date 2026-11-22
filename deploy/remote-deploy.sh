#!/usr/bin/env bash
# Runs on the server as the activists user.
# Switches /opt/activiststable/current and restarts activiststable.service.
set -euo pipefail

SHA="${1:?usage: remote-deploy.sh <git-sha>}"
APP=/opt/activiststable
REL="$APP/releases/$SHA"
SERVICE=activiststable
HEALTH=http://127.0.0.1:3010/
KEEP=5

exec 9>"$APP/.deploy.lock"
flock -n 9 || { echo "another deploy is running"; exit 1; }

if [ ! -f "$APP/incoming/release.tgz" ]; then
  echo "missing $APP/incoming/release.tgz" >&2
  exit 1
fi

rm -rf "$REL"
mkdir -p "$REL"
tar -xzf "$APP/incoming/release.tgz" -C "$REL"
rm -f "$APP/incoming/release.tgz"

install -d -m 750 "$APP/data"
if [ -f "$REL/schema.sql" ] && command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$APP/data/activists.db" < "$REL/schema.sql" || true
fi

PREV="$(readlink -f "$APP/current" 2>/dev/null || true)"
ln -sfn "$REL" "$APP/current.new"
mv -Tf "$APP/current.new" "$APP/current"
sudo /usr/bin/systemctl restart "$SERVICE"

for _ in $(seq 1 45); do
  if curl -fsS -o /dev/null --max-time 2 "$HEALTH"; then
    echo "deployed $SHA"
    ls -1dt "$APP"/releases/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
      if [ "$(readlink -f "$old")" != "$(readlink -f "$APP/current")" ]; then
        rm -rf "$old"
      fi
    done
    exit 0
  fi
  sleep 1
done

echo "health check failed for $SHA" >&2
if [ -n "${PREV:-}" ] && [ -d "$PREV" ]; then
  ln -sfn "$PREV" "$APP/current.new"
  mv -Tf "$APP/current.new" "$APP/current"
  sudo /usr/bin/systemctl restart "$SERVICE"
  echo "rolled back to $(basename "$PREV")" >&2
fi
exit 1
