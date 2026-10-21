#!/usr/bin/env bash
# Tracker stage 2 — step 1: turn on real logins. Run as root on the server.
# Usage:  bash deploy/20-auth-setup.sh 'NEW-ADMIN-PASSWORD' 'NEW-TEACHER-PASSWORD'
# Passwords are stored only as scrypt hashes. The teacher password is set for every teacher in the table.
# Safe to run before the new pages are live (the old pages keep working until 21-lockdown.sh).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo -i)"; exit 1; }
ADMINPW="${1:-}"; TEACHERPW="${2:-}"
[ ${#ADMINPW} -ge 8 ] && [ ${#TEACHERPW} -ge 6 ] || { echo "Give two passwords: admin (8+ characters) and teacher (6+ characters)."; echo "  bash deploy/20-auth-setup.sh 'admin-pw' 'teacher-pw'"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"; APP="$(dirname "$HERE")"
SS=/opt/shalakasi/pg; . "$SS/secrets.env"; . "$SS/info.env"
PSQL="sudo -u postgres psql -p $PGPORT -d tracker -v ON_ERROR_STOP=1 -q"
NODE=/opt/node22/bin/node
[ "$APP" = /opt/ekasi-backend ] || { echo "Expected /opt/ekasi-backend"; exit 1; }

echo "== 1/4 Settings table"
cp "$HERE/tracker_auth.sql" /tmp/trk_auth.sql; chmod 644 /tmp/trk_auth.sql
$PSQL -f /tmp/trk_auth.sql; rm -f /tmp/trk_auth.sql

echo "== 2/4 Session secret"
ENVF="$APP/.env"
if ! grep -qE '^SESSION_SECRET=.+' "$ENVF"; then
  echo "SESSION_SECRET=$(openssl rand -hex 32)" >> "$ENVF"
fi
chown ekasi:ekasi "$ENVF"; chmod 600 "$ENVF"

echo "== 3/4 Saving password hashes"
AH=$(cd "$APP" && ADMINPW="$ADMINPW" $NODE -e 'console.log(require("./auth").hashPassword(process.env.ADMINPW))')
TH=$(cd "$APP" && TEACHERPW="$TEACHERPW" $NODE -e 'console.log(require("./auth").hashPassword(process.env.TEACHERPW))')
$PSQL <<SQL
insert into app_settings(key,value) values ('admin_password','$AH')
  on conflict (key) do update set value = excluded.value;
update teachers set password = '$TH';
SQL
n=$($PSQL -Atc "select count(*) from teachers")
echo "   admin password set; teacher password set for $n teacher(s)"

echo "== 4/4 Restart backend"
systemctl restart ekasi-backend; sleep 3
curl -s -o /dev/null -w '   login with wrong password -> HTTP %{http_code} (want 401)\n' -X POST http://127.0.0.1:3920/auth/login -H 'Content-Type: application/json' -d '{"role":"admin","password":"wrong-password"}'
echo "Done. Old pages still work for now. Next: publish the new pages, test, then run 21-lockdown.sh."
