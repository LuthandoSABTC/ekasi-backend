#!/usr/bin/env bash
# Dry run: shows which Stack & Study students match a tracker student by name. Writes nothing.
#   bash deploy/23-match-names.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo -i)"; exit 1; }
. /opt/shalakasi/pg/info.env
sudo -u postgres psql -p "$PGPORT" -d stackstudy -Atc "select full_name from students where active order by full_name" > /tmp/ss_names.txt
sudo -u postgres psql -p "$PGPORT" -d tracker -Atc "select name from students where status='active' union select name from postgrad_students order by 1" > /tmp/trk_names.txt
/opt/node22/bin/node -e '
const fs=require("fs");
const norm=n=>String(n||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9 ]+/g," ").split(/\s+/).filter(Boolean);
const same=(a,b)=>{const x=norm(a),y=norm(b);return x.length&&x.join(" ")===y.join(" ")||(x.length>1&&x.slice().sort().join(" ")===y.slice().sort().join(" "))};
const ss=fs.readFileSync("/tmp/ss_names.txt","utf8").split("\n").filter(Boolean);
const tr=fs.readFileSync("/tmp/trk_names.txt","utf8").split("\n").filter(Boolean);
let ok=0,bad=0;
for(const n of ss){const m=tr.filter(t=>same(t,n));
 if(m.length===1){ok++;console.log("MATCH     ",n,"  =  ",m[0]);}
 else {bad++;console.log(m.length?"AMBIGUOUS ":"NO MATCH  ",n, m.length?"  ("+m.join(" / ")+")":"");}}
console.log("\n"+ok+" match, "+bad+" need fixing. Fix a name in either app so both spell it the same.");
'
rm -f /tmp/ss_names.txt /tmp/trk_names.txt
