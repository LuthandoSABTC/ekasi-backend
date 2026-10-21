#!/usr/bin/env bash
# Staff wallet balances. Run as root on the server AFTER pulling this code update:
#   cd /opt/ekasi-backend && git pull && bash deploy/24-staff-wallets.sh
# - tracker database: adds the staff_wallet_keys table
# - makes WALLET_KEY_SECRET in .env (kept if it already exists — changing it makes stored keys unreadable)
# - restarts the backend and checks the new address answers
# Safe to run again.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo -i)"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
. /opt/shalakasi/pg/info.env
TENV=/opt/ekasi-backend/.env
[ -f "$TENV" ] || { echo "Missing $TENV"; exit 1; }

echo "== 1/3 Database"
cp "$HERE/tracker_staff_wallets.sql" /tmp/trk_sw.sql; chmod 644 /tmp/trk_sw.sql
sudo -u postgres psql -p "$PGPORT" -d tracker -v ON_ERROR_STOP=1 -q -f /tmp/trk_sw.sql; rm -f /tmp/trk_sw.sql

echo "== 2/3 Secret"
if grep -qE '^WALLET_KEY_SECRET=.{32,}' "$TENV"; then
  echo "   WALLET_KEY_SECRET already set — keeping it"
else
  echo "WALLET_KEY_SECRET=$(openssl rand -hex 32)" >> "$TENV"
  echo "   WALLET_KEY_SECRET created. If it is ever lost, staff just re-link their keys — nothing else breaks."
fi
chown ekasi:ekasi "$TENV"; chmod 600 "$TENV"

echo "== 3/3 Restart + check"
systemctl restart ekasi-backend; sleep 4
a=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3920/staff-wallets/balances)
echo "   balances address without login: HTTP $a (want 401)"
[ "$a" = 401 ] && echo "OK — staff wallet balances are on." || { echo "Something is off — send me the lines above (and: journalctl -u ekasi-backend -n 30)."; exit 1; }
