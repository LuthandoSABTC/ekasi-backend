#!/usr/bin/env bash
# Stack & Study <-> Tracker link. Run as root on the server AFTER both code updates are pulled.
#   bash deploy/22-stack-link.sh '165.165.246.150'          (class WiFi address; several: 'a.b.c.d,e.f.g.h')
# - tracker database: adds the stack_logins table
# - Stack & Study database: adds a counter so each review attempt gets a fresh mix of questions
# - makes one shared secret and puts it in both apps' settings, then restarts both
# Safe to run again (keeps the existing secret; only the class address list is replaced).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo -i)"; exit 1; }
CLASSIPS="${1:-}"; [ -n "$CLASSIPS" ] || { echo "Give the class WiFi address, e.g.  bash deploy/22-stack-link.sh '165.165.246.150'"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
. /opt/shalakasi/pg/info.env
TENV=/opt/ekasi-backend/.env; SENV=/opt/shalakasi/app/.env
[ -f "$TENV" ] && [ -f "$SENV" ] || { echo "Missing $TENV or $SENV"; exit 1; }

echo "== 1/4 Databases"
cp "$HERE/tracker_stack_logins.sql" /tmp/trk_sl.sql; chmod 644 /tmp/trk_sl.sql
sudo -u postgres psql -p "$PGPORT" -d tracker -v ON_ERROR_STOP=1 -q -f /tmp/trk_sl.sql; rm -f /tmp/trk_sl.sql
sudo -u postgres psql -p "$PGPORT" -d stackstudy -v ON_ERROR_STOP=1 -q -c "alter table chapter_reviews add column if not exists attempts int not null default 0;"

echo "== 2/4 Shared secret"
KEY=$(grep -E '^STACK_INTEGRATION_KEY=.+' "$TENV" | tail -1 | cut -d= -f2- || true)
[ -n "$KEY" ] || KEY=$(openssl rand -hex 24)
setenv() { # file name value
  if grep -qE "^$2=" "$1"; then sed -i "s|^$2=.*|$2=$3|" "$1"; else echo "$2=$3" >> "$1"; fi
}
setenv "$TENV" STACK_INTEGRATION_KEY "$KEY"
setenv "$TENV" CLASS_IPS "$CLASSIPS"
setenv "$SENV" TRACKER_URL "http://127.0.0.1:3920"
setenv "$SENV" TRACKER_KEY "$KEY"
chown ekasi:ekasi "$TENV"; chmod 600 "$TENV"
chown --reference=/opt/shalakasi/app "$SENV" 2>/dev/null || true; chmod 600 "$SENV"

echo "== 3/4 Restart both apps"
systemctl restart ekasi-backend; systemctl restart shalakasi; sleep 4

echo "== 4/4 Checks"
a=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3920/integrations/stack-login -H 'Content-Type: application/json' -H 'X-Integration-Key: wrong' -d '{"name":"x"}')
b=$(curl -s -X POST http://127.0.0.1:3920/integrations/stack-login -H 'Content-Type: application/json' -H "X-Integration-Key: $KEY" -d '{"name":"Nobody Test","ip":"1.2.3.4"}')
c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3300/)
echo "   tracker refuses a wrong key: HTTP $a (want 401)"
echo "   tracker accepts the real key: $b (want {\"matched\":false})"
echo "   Stack & Study answers: HTTP $c (want 200)"
[ "$a" = 401 ] && [ "$c" = 200 ] && echo "$b" | grep -q '"matched":false' && echo "OK — link is on." || { echo "Something is off — send me the lines above."; exit 1; }
