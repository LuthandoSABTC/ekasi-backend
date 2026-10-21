#!/usr/bin/env bash
# Tracker stage 2 — step 2: close the open database door. Run as root AFTER the new pages are live and tested.
# After this, the old direct-to-database access (public key) stops working; everything goes through logins.
# Undo with:  bash deploy/21-lockdown.sh undo
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo -i)"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
SS=/opt/shalakasi/pg; . "$SS/secrets.env"; . "$SS/info.env"
PSQL="sudo -u postgres psql -p $PGPORT -d tracker -v ON_ERROR_STOP=1 -q"
CF=/etc/caddy/Caddyfile; HOST=tracker.learn-bitcoinekasi.it.com

if [ "${1:-}" = undo ]; then
  b=$(ls -t "$CF".pre-lockdown-* 2>/dev/null | head -1) || true
  [ -n "${b:-}" ] || { echo "No Caddy backup found"; exit 1; }
  cp "$b" "$CF"; caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1 && systemctl reload caddy
  cp "$HERE/tracker_anon_open.sql" /tmp/trk_open.sql; chmod 644 /tmp/trk_open.sql; $PSQL -f /tmp/trk_open.sql; rm -f /tmp/trk_open.sql
  echo "Undone: the open door is back (old behaviour)."; exit 0
fi

echo "== 1/3 Database: remove public access"
$PSQL <<'SQL'
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('drop policy if exists anon_open on public.%I', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
notify pgrst, 'reload schema';
SQL

echo "== 2/3 Web address: remove the /rest/v1 shortcut"
cp "$CF" "$CF.pre-lockdown-$(date +%Y%m%d-%H%M%S)"
python3 - "$CF" "$HOST" <<'PY'
import sys,re
path,host=sys.argv[1],sys.argv[2]
s=open(path).read()
i=s.index(host+" {")
j=s.index("handle /rest/v1/*",i)
# find the end of that handle block by brace matching
k=s.index("{",j); depth=0; e=k
while True:
    if s[e]=="{": depth+=1
    elif s[e]=="}":
        depth-=1
        if depth==0: break
    e+=1
# also drop the preceding comment line and the block
start=s.rfind("\n",0,j)
prev=s.rfind("\n",0,start)
if s[prev+1:start].strip().startswith("#"): start=prev
s=s[:start]+s[e+1:]
open(path,"w").write(s)
PY
caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1 || { echo "Caddy config check failed — restoring"; cp "$(ls -t "$CF".pre-lockdown-* | head -1)" "$CF"; exit 1; }
systemctl reload caddy

echo "== 3/3 Check"
sleep 1
a=$(curl -s -o /dev/null -w '%{http_code}' "https://$HOST/rest/v1/students?select=name")
b=$(curl -s -o /dev/null -w '%{http_code}' "https://$HOST/db/students")
c=$(curl -s -o /dev/null -w '%{http_code}' "https://$HOST/public/leaderboard")
echo "   old direct door: HTTP $a (want 401/404);  /db without login: HTTP $b (want 401);  public leaderboard: HTTP $c (want 200)"
[ "$b" = 401 ] && [ "$c" = 200 ] && [ "$a" != 200 ] && echo "OK — locked down." || { echo "Something is off — send me the lines above."; exit 1; }
