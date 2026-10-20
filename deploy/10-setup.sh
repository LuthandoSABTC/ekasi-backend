#!/usr/bin/env bash
# Bitcoin Ekasi Attendance Tracker — step 1: its own database + backend on this server.
# Run as root on the server, from /opt/ekasi-backend:   bash deploy/10-setup.sh
# Needs the Stack & Study setup already in place (Postgres 17 + PostgREST, /opt/shalakasi/pg).
# Safe to re-run. Does NOT start the backend (so nothing is sent twice): 12-switch.sh does that.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo -i)"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"; APP="$(dirname "$HERE")"
SS=/opt/shalakasi/pg; . "$SS/secrets.env"; . "$SS/info.env"     # AUTHPW, PGPORT
BASE=/opt/ekasi-backend/pg; DB=tracker; HOST=tracker.learn-bitcoinekasi.it.com; PRPORT=3402; BEPORT=3920
NODE=/opt/node22/bin/node; NPM=/opt/node22/bin/npm
[ "$APP" = /opt/ekasi-backend ] || { echo "Expected the code in /opt/ekasi-backend (found $APP)"; exit 1; }
PSQL="sudo -u postgres psql -p $PGPORT -v ON_ERROR_STOP=1 -q"

echo "== 1/6 Database"
if ! sudo -u postgres psql -p "$PGPORT" -Atc "select 1 from pg_database where datname='$DB'" | grep -q 1; then
  sudo -u postgres createdb -p "$PGPORT" "$DB"
  cp "$HERE/tracker_schema.sql" /tmp/trk_schema.sql; chmod 644 /tmp/trk_schema.sql
  $PSQL -d "$DB" -f /tmp/trk_schema.sql >/dev/null; rm -f /tmp/trk_schema.sql
else echo "   database $DB already exists — leaving its tables alone"; fi
# authenticator must be able to log in with the shared password (set by the Stack & Study setup)
cp "$HERE/tracker_roles.sql" /tmp/trk_roles.sql; cp "$HERE/tracker_anon_open.sql" /tmp/trk_open.sql; chmod 644 /tmp/trk_*.sql
$PSQL -d "$DB" -f /tmp/trk_roles.sql >/dev/null 2>&1
$PSQL -d "$DB" -f /tmp/trk_open.sql >/dev/null 2>&1
rm -f /tmp/trk_roles.sql /tmp/trk_open.sql

echo "== 2/6 Keys"
install -d -m 755 "$BASE"
if [ ! -f "$BASE/secrets.env" ]; then umask 077; echo "TRK_JWT_SECRET=$(openssl rand -hex 32)" > "$BASE/secrets.env"; fi
. "$BASE/secrets.env"
b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
mk() { local H P G; H=$(printf '{"alg":"HS256","typ":"JWT"}'|b64); P=$(printf '{"role":"%s","iss":"ekasi-tracker"}' "$1"|b64)
       G=$(printf '%s.%s' "$H" "$P"|openssl dgst -sha256 -hmac "$TRK_JWT_SECRET" -binary|b64); echo "$H.$P.$G"; }
umask 077; mk service_role > "$BASE/service_key.txt"; mk anon > "$BASE/anon_key.txt"

echo "== 3/6 PostgREST for the tracker (port $PRPORT, localhost only)"
cat > "$BASE/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:$AUTHPW@127.0.0.1:$PGPORT/$DB"
db-schemas = "public"
jwt-secret = "$TRK_JWT_SECRET"
server-host = "127.0.0.1"
server-port = $PRPORT
CONF
chown root:postgrest "$BASE/postgrest.conf"; chmod 640 "$BASE/postgrest.conf"
cat > /etc/systemd/system/postgrest-tracker.service <<UNIT
[Unit]
Description=PostgREST for the Attendance Tracker (localhost only)
After=postgresql@17-main.service
Requires=postgresql@17-main.service
[Service]
User=postgrest
ExecStart=/opt/postgrest/postgrest $BASE/postgrest.conf
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT

echo "== 4/6 Backend (installed, NOT started)"
id ekasi >/dev/null 2>&1 || useradd --system --home /opt/ekasi-backend --shell /usr/sbin/nologin ekasi
( cd "$APP" && PATH=/opt/node22/bin:$PATH $NPM install --omit=dev --silent )
ENVF="$APP/.env"
if [ ! -f "$ENVF" ]; then
  umask 077
  cat > "$ENVF" <<ENV
PORT=$BEPORT
POSTGREST_URL=http://127.0.0.1:$PRPORT
SUPABASE_KEY=$(cat "$BASE/service_key.txt")
# Copy these from Render → ekasi-backend → Environment (leave a line out if Render does not have it):
GMAIL_USER=luthando@bitcoinekasi.com
GMAIL_APP_PASSWORD=
TELEGRAM_BOT_TOKEN=
COMMUNITY_RECAP_WHATSAPP_NUMBER=
COMMUNITY_RECAP_CALLMEBOT_APIKEY=
ENV
fi
chown -R ekasi:ekasi "$APP"; chmod 600 "$ENVF"
cat > /etc/systemd/system/ekasi-backend.service <<UNIT
[Unit]
Description=Bitcoin Ekasi Attendance Tracker backend
After=network.target postgrest-tracker.service
[Service]
User=ekasi
WorkingDirectory=$APP
EnvironmentFile=$ENVF
ExecStart=$NODE server.js
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now postgrest-tracker >/dev/null 2>&1; systemctl restart postgrest-tracker

echo "== 5/6 Web address (Caddy)"
CF=/etc/caddy/Caddyfile
if ! grep -q "$HOST" "$CF"; then
  cp "$CF" "$CF.bak-$(date +%Y%m%d-%H%M%S)"
  cat >> "$CF" <<CADDY

$HOST {
	# The pages talk to the database under /rest/v1/ (same shape as before); we add the key here.
	handle /rest/v1/* {
		uri strip_prefix /rest/v1
		reverse_proxy 127.0.0.1:$PRPORT {
			header_up Authorization "Bearer $(cat "$BASE/anon_key.txt")"
		}
	}
	handle {
		reverse_proxy 127.0.0.1:$BEPORT
	}
}
CADDY
  caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1 || { echo "Caddy config check failed — restoring the old file"; cp "$CF.bak-"* "$CF" 2>/dev/null; exit 1; }
  systemctl reload caddy
else echo "   Caddy already has $HOST"; fi

echo "== 6/6 Check"
sleep 2
c=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $(cat "$BASE/service_key.txt")" "http://127.0.0.1:$PRPORT/students?limit=1")
n=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PRPORT/students?limit=1")
an=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $(cat "$BASE/anon_key.txt")" "http://127.0.0.1:$PRPORT/students?limit=1")
echo "   service key: HTTP $c (want 200);  page (anon) key: HTTP $an (want 200);  no key: HTTP $n (want 401)"
[ "$c" = 200 ] && [ "$an" = 200 ] && [ "$n" = 401 ] && echo "OK — tracker database ready (empty). Backend is installed but NOT running. Nothing changed for anyone." || { echo "Something is off — send me the lines above."; exit 1; }
