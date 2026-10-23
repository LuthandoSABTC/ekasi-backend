const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const cron = require("node-cron");
const nodemailer = require("nodemailer");
const auth = require("./auth");
 
const app = express();
app.set("trust proxy", 1); // behind Caddy: use the real visitor IP for rate limits
app.use(cors());
app.use(express.json());
 
const BLINK_URL = "https://api.blink.sv/graphql";
const COMMUNITY_RECAP_WHATSAPP_NUMBER = process.env.COMMUNITY_RECAP_WHATSAPP_NUMBER;
const COMMUNITY_RECAP_CALLMEBOT_APIKEY = process.env.COMMUNITY_RECAP_CALLMEBOT_APIKEY;
const GMAIL_USER = process.env.GMAIL_USER || "luthando@bitcoinekasi.com";
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const ALERT_TO = ["luthando@bitcoinekasi.com"];
const DAILY_SUMMARY_CC = ["sassa@bitcoinekasi.com"];
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
 
// ── Send email alert via Gmail SMTP ──────────────────────────
// Sends as GMAIL_USER's real mailbox (an app password, not the account
// password — see Google Account → Security → App Passwords). Unlike
// Resend's shared onboarding@resend.dev sandbox sender, a real mailbox
// can email any recipient, so `cc` works for anyone.
const mailTransporter = GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
    })
  : null;
 
async function sendAlert(subject, body, cc) {
  if (!mailTransporter) { console.log("No GMAIL_APP_PASSWORD — skipping alert"); return; }
  try {
    const mailOptions = {
      from: `"Bitcoin Ekasi" <${GMAIL_USER}>`,
      to: ALERT_TO.join(","),
      subject: subject,
      html: body
    };
    if (cc && cc.length) mailOptions.cc = cc.join(",");
    await mailTransporter.sendMail(mailOptions);
    console.log("Alert sent:", subject);
  } catch(e) {
    console.error("Alert failed:", e.message);
  }
}
 
// ── Send WhatsApp payment notification via CallMeBot ─────────
async function sendWhatsAppPayment(whatsappNumber, apikey, staffName, amount) {
  if (!whatsappNumber || !apikey) {
    console.log("No CallMeBot credentials for", staffName, "— skipping WhatsApp notification");
    return;
  }
  const cleanNumber = whatsappNumber.replace(/[\s+]/g, "");
  try {
    const message = `⚡ Hi ${staffName}! ${amount.toLocaleString()} sats have just landed in your wallet. Thank you for the incredible work you do shaping the next generation at Bitcoin Ekasi — your dedication doesn't go unnoticed. 🙏`;
    const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanNumber}&text=${encodeURIComponent(message)}&apikey=${apikey}`;
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) console.error("CallMeBot error:", text.slice(0, 200));
    else console.log("WhatsApp sent to", staffName, "-", text.slice(0, 100));
  } catch (e) {
    console.error("WhatsApp send failed:", e.message);
  }
}
 
// ── Send Telegram payment notification ────────────────────────
async function sendTelegramPayment(chatId, staffName, amount) {
  if (!chatId || !TELEGRAM_BOT_TOKEN) {
    console.log("No Telegram credentials for", staffName, "— skipping Telegram notification");
    return;
  }
  try {
    const message = `⚡ Hi ${staffName}! ${amount.toLocaleString()} sats have just landed in your wallet. Thank you for the incredible work you do shaping the next generation at Bitcoin Ekasi — your dedication doesn't go unnoticed. 🙏`;
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message })
    });
    const data = await res.json();
    if (!data.ok) console.error("Telegram error:", JSON.stringify(data));
    else console.log("Telegram sent to", staffName);
  } catch (e) {
    console.error("Telegram send failed:", e.message);
  }
}
 
function payFailEmail(recipientName, recipientType, amount, errorMsg) {
  const now = new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
  const subject = "Bitcoin Ekasi - Payment Failed: " + recipientName;
  const html = [
    '<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#0A0A0F;color:#F0F0F8;border-radius:12px;overflow:hidden">',
    '<div style="background:#F7931A;padding:20px 24px;text-align:center">',
    '<div style="font-size:32px;margin-bottom:8px">&#9888;&#65039;</div>',
    '<div style="font-size:20px;font-weight:800;color:#000">Payment Failed</div>',
    '<div style="font-size:12px;color:rgba(0,0,0,0.7);margin-top:4px">Bitcoin Ekasi Attendance Tracker</div>',
    '</div>',
    '<div style="padding:28px 24px">',
    '<div style="background:#16161F;border-radius:10px;padding:18px;margin-bottom:20px">',
    '<div style="font-size:18px;font-weight:700;margin-bottom:4px">' + recipientName + '</div>',
    '<div style="font-size:12px;color:#9090A8;margin-bottom:14px">' + recipientType + '</div>',
    '<div style="font-size:26px;font-weight:800;color:#F7931A;margin-bottom:10px">&#9889;' + amount.toLocaleString() + ' sats</div>',
    '<div style="font-size:11px;color:#F87171;background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.2);border-radius:6px;padding:8px 12px;word-break:break-word">' + errorMsg + '</div>',
    '</div>',
    '<div style="font-size:12px;color:#55556A;margin-bottom:20px">Time: ' + now + ' SAST</div>',
    '<a href="https://luthandosabtc.github.io/bitcoinekasi/" style="display:block;background:#F7931A;color:#000;text-align:center;padding:13px;border-radius:8px;font-weight:700;text-decoration:none;font-size:14px">Open App to Retry</a>',
    '</div></div>'
  ].join("");
  return sendAlert(subject, html);
}
 
// ── Supabase config ──
// Self-hosted mode: set POSTGREST_URL (e.g. http://127.0.0.1:3402) to use our own Postgres
// through PostgREST instead of Supabase. SUPABASE_KEY then holds our own service key.
const POSTGREST_URL = process.env.POSTGREST_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
 
if ((!SUPABASE_URL && !POSTGREST_URL) || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY environment variables — backend cannot start.");
  process.exit(1);
}
async function supabase(method, table, body = null, params = '') {
  const url = `${POSTGREST_URL || (SUPABASE_URL + '/rest/v1')}/${table}${params}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  // Transient Supabase Kong gateway timeouts (502/503/504) and network errors
  // are retried with exponential backoff, but only for GET requests — writes
  // and 4xx errors (bad request/auth/data issues) fail immediately so we
  // never mask a real error or risk a duplicate write.
  const maxRetries = method === 'GET' ? 2 : 0;
  let attempt = 0;
  while (true) {
    let res, text;
    try {
      res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : null });
      text = await res.text();
    } catch (networkErr) {
      if (attempt < maxRetries) {
        const delay = 500 * Math.pow(2, attempt);
        console.log(`Supabase ${method} ${table}: network error (${networkErr.message}), retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        attempt++;
        continue;
      }
      throw networkErr;
    }
    console.log(`Supabase ${method} ${table}:`, res.status, text.slice(0, 200));
    if (!res.ok) {
      const isTransient = res.status === 502 || res.status === 503 || res.status === 504;
      if (isTransient && attempt < maxRetries) {
        const delay = 500 * Math.pow(2, attempt);
        console.log(`Supabase ${method} ${table}: ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        attempt++;
        continue;
      }
      throw new Error(text);
    }
    return text ? JSON.parse(text) : [];
  }
}
 
// ── Safe JSON fetch helper (catches HTML error pages) ──
async function safeFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (text.trim().startsWith('<')) {
    throw new Error(`Server returned HTML (status ${res.status}) — service may be down`);
  }
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch (e) {
    throw new Error(`Invalid JSON response: ${text.slice(0, 100)}`);
  }
}
 
// ── LNURL bech32 decoder (no external library needed) ──
function decodeLnurl(lnurl) {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const str = lnurl.toLowerCase().replace('lightning:', '').trim();
  const sep = str.lastIndexOf('1');
  if (sep < 1) throw new Error('Invalid LNURL: no separator found');
  const dataChars = str.slice(sep + 1, -6);
  const data = [];
  for (const c of dataChars) {
    const v = CHARSET.indexOf(c);
    if (v < 0) throw new Error(`Invalid LNURL char: ${c}`);
    data.push(v);
  }
  let acc = 0, bits = 0;
  const bytes = [];
  for (const val of data) {
    acc = (acc << 5) | val;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}
 
app.get("/", (req, res) => res.json({ status: "Bitcoin Ekasi Backend Running ⚡" }));
 
// ── Logins (stage 2) ──
const ADMIN_ONLY = auth.requireAuth("admin");
const ANY_LOGIN = auth.requireAuth("admin", "teacher");

// ── Staff wallet balances (admin only, read-only Blink keys, with consent) ──
require("./staff-wallets")(app, { supabase, ADMIN_ONLY, fetch });

async function getSetting(key) {
  const rows = await supabase("GET", "app_settings", null, `?key=eq.${encodeURIComponent(key)}&select=value`);
  return rows && rows[0] ? rows[0].value : null;
}
async function setSetting(key, value) {
  const rows = await supabase("GET", "app_settings", null, `?key=eq.${encodeURIComponent(key)}&select=key`);
  if (rows && rows.length) await supabase("PATCH", "app_settings", { value }, `?key=eq.${encodeURIComponent(key)}`);
  else await supabase("POST", "app_settings", { key, value });
}

app.post("/auth/login", async (req, res) => {
  try {
    const { role, teacherId, password } = req.body || {};
    if (!password || typeof password !== "string" || !["admin", "teacher"].includes(role)) {
      return res.status(400).json({ error: "Missing details" });
    }
    const key = `${req.ip}|${role}|${teacherId || ""}`;
    if (auth.tooManyAttempts(key)) return res.status(429).json({ error: "Too many tries. Wait 15 minutes and try again." });
    let ok = false, user = { role };
    if (role === "admin") {
      ok = auth.verifyPassword(password, await getSetting("admin_password"));
    } else {
      if (!teacherId) return res.status(400).json({ error: "Missing details" });
      const rows = await supabase("GET", "teachers", null, `?id=eq.${encodeURIComponent(teacherId)}&select=id,name,password`);
      const t = rows && rows[0];
      ok = !!t && auth.verifyPassword(password, t.password);
      if (ok) user = { role, teacherId: t.id, name: t.name };
    }
    if (!ok) return res.status(401).json({ error: "Wrong password" });
    auth.clearAttempts(key);
    res.json({ token: auth.makeToken(user), role, hours: auth.TOKEN_HOURS });
  } catch (e) { console.error("login error:", e.message); res.status(500).json({ error: "Login failed" }); }
});

app.get("/auth/me", ANY_LOGIN, (req, res) => res.json({ role: req.user.role, teacherId: req.user.teacherId || null }));

// Change a password. Admin may change the admin password or any teacher's; a teacher only their own.
app.post("/auth/change-password", ANY_LOGIN, async (req, res) => {
  try {
    const { target, teacherId, newPassword } = req.body || {};
    if (typeof newPassword !== "string" || newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });
    if (target === "admin") {
      if (req.user.role !== "admin") return res.status(403).json({ error: "Not allowed" });
      await setSetting("admin_password", auth.hashPassword(newPassword));
    } else if (target === "teacher") {
      const id = req.user.role === "admin" ? teacherId : req.user.teacherId;
      if (!id) return res.status(400).json({ error: "Missing teacher" });
      await supabase("PATCH", "teachers", { password: auth.hashPassword(newPassword) }, `?id=eq.${encodeURIComponent(id)}`);
    } else return res.status(400).json({ error: "Missing details" });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Could not change password" }); }
});

// ── Database proxy (requires login) ──
// Tables the pages may use. teachers/payments are read-only here; app_settings and other apps' tables are not reachable.
const DB_TABLES = new Set(["stack_logins","students","attendance","chapters","excuses","postgrad_students","postgrad_attendance","postgrad_excuses","shack_owners","shack_checkins","staff","staff_attendance","teachers","payments"]);
const DB_READONLY = new Set(["teachers","payments","stack_logins"]);
function checkTable(req, res, next) {
  const t = req.params.table;
  if (!DB_TABLES.has(t)) return res.status(404).json({ error: "Unknown table" });
  if (req.method !== "GET" && DB_READONLY.has(t)) return res.status(403).json({ error: "Read-only table" });
  if (t === "payments" && req.user.role !== "admin") return res.status(403).json({ error: "Not allowed for your account" });
  next();
}
const dbParams = (req) => req.url.replace(`/db/${req.params.table}`, "") || "";

app.get("/db/:table", ANY_LOGIN, checkTable, async (req, res) => {
  try {
    let data = await supabase("GET", req.params.table, null, dbParams(req));
    if (req.params.table === "teachers" && Array.isArray(data)) data = data.map(({ password, ...rest }) => rest);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/db/:table", ANY_LOGIN, checkTable, async (req, res) => {
  try { res.json(await supabase("POST", req.params.table, req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch("/db/:table", ANY_LOGIN, checkTable, async (req, res) => {
  try { res.json(await supabase("PATCH", req.params.table, req.body, dbParams(req))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/db/:table", ANY_LOGIN, checkTable, async (req, res) => {
  try { await supabase("DELETE", req.params.table, null, dbParams(req)); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Study & Stack → tracker link ──
// Study & Stack calls this when a student logs in. We note the login; we never mark paid attendance.
// "In class" = Monday–Friday, 14:45–17:00 South African time, from a class network address, and on a day the student is scheduled
// to come (Study & Stack sends scheduled_today; when it is missing or null the student has no group yet, so the day does not matter).
const STACK_KEY = process.env.STACK_INTEGRATION_KEY || "";
const CLASS_IPS = (process.env.CLASS_IPS || "").split(",").map(x => x.trim()).filter(Boolean);
const normName = (n) => String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
const sameName = (a, b) => { const x = normName(a), y = normName(b); return x.length && x.join(" ") === y.join(" ") || (x.length > 1 && x.slice().sort().join(" ") === y.slice().sort().join(" ")); };
function sastNow() { const d = new Date(Date.now() + 2 * 3600 * 1000); return { day: d.getUTCDay(), mins: d.getUTCHours() * 60 + d.getUTCMinutes(), date: d.toISOString().slice(0, 10) }; }
function inClassWindow(n) { return n.day >= 1 && n.day <= 5 && n.mins >= 14 * 60 + 45 && n.mins <= 17 * 60; }

app.post("/integrations/stack-login", async (req, res) => {
  try {
    const given = req.headers["x-integration-key"] || "";
    const a = Buffer.from(String(given)), b = Buffer.from(STACK_KEY);
    if (!STACK_KEY || a.length !== b.length || !require("crypto").timingSafeEqual(a, b)) return res.status(401).json({ error: "Not allowed" });
    const { name, ip, scheduled_today } = req.body || {};
    if (!name) return res.status(400).json({ error: "Missing name" });
    const now = sastNow();
    const inClass = inClassWindow(now) && scheduled_today !== false && CLASS_IPS.includes(String(ip || "").replace(/^::ffff:/, ""));
    let kind = "diploma", match = (await supabase("GET", "students", null, "?select=id,name&status=eq.active")).filter(s => sameName(s.name, name));
    if (!match.length) { kind = "postgrad"; match = (await supabase("GET", "postgrad_students", null, "?select=id,name")).filter(s => sameName(s.name, name)); }
    if (match.length !== 1) { console.log(`stack-login: no single match for "${name}" (${match.length})`); return res.json({ matched: false }); }
    const id = match[0].id;
    const rows = await supabase("GET", "stack_logins", null, `?kind=eq.${kind}&student_id=eq.${id}&date=eq.${now.date}&select=id,in_class`);
    if (!rows.length) await supabase("POST", "stack_logins", { kind, student_id: id, date: now.date, in_class: inClass });
    else if (inClass && !rows[0].in_class) await supabase("PATCH", "stack_logins", { in_class: true }, `?id=eq.${rows[0].id}`);
    res.json({ matched: true, inClass });
  } catch (e) { console.error("stack-login error:", e.message); res.status(500).json({ error: "Failed" }); }
});

// ── Study & Stack rewards → tracker payout ──
// Study & Stack sends each reward (passed chapter review or book test) here. It waits for approval on the admin page; once approved
// the sats are added to the student's bonus, so the normal payout pays them together with the attendance sats.
function stackKeyOk(req) {
  const given = req.headers["x-integration-key"] || "";
  const a = Buffer.from(String(given)), b = Buffer.from(STACK_KEY);
  return !!STACK_KEY && a.length === b.length && require("crypto").timingSafeEqual(a, b);
}
const REF_OK = /^[0-9a-fA-F-]{8,64}$/;

// An approved reward becomes "paid" once the student's paid total has caught up with everything they have earned
// (same sum the payout screen uses: attendance days x 500 + bonus).
async function settleRewards() {
  const approved = await supabase("GET", "stack_rewards", null, "?status=eq.approved&select=student_id");
  for (const sid of [...new Set(approved.map(r => r.student_id))]) {
    const [st] = await supabase("GET", "students", null, `?id=eq.${sid}&select=paid,bonus`);
    if (!st) continue;
    const days = (await supabase("GET", "attendance", null, `?student_id=eq.${sid}&select=id`)).length;
    if ((st.paid || 0) >= days * 500 + (st.bonus || 0)) {
      await supabase("PATCH", "stack_rewards", { status: "paid" }, `?student_id=eq.${sid}&status=eq.approved`);
    }
  }
}

app.post("/integrations/stack-reward", async (req, res) => {
  try {
    if (!stackKeyOk(req)) return res.status(401).json({ error: "Not allowed" });
    const { ref, name, kind, label, amount_sats } = req.body || {};
    const amount = Number(amount_sats);
    if (!REF_OK.test(String(ref || "")) || !name || !Number.isInteger(amount) || amount < 1 || amount > 100000) return res.status(400).json({ error: "Bad reward" });
    const existing = await supabase("GET", "stack_rewards", null, `?ref=eq.${encodeURIComponent(ref)}&select=status`);
    if (existing.length) return res.json({ matched: true, status: existing[0].status });
    const rows = (await supabase("GET", "students", null, "?select=id,name&status=eq.active")).filter(s => sameName(s.name, name));
    if (rows.length !== 1) { console.log(`stack-reward: no single match for "${name}" (${rows.length})`); return res.json({ matched: false }); }
    await supabase("POST", "stack_rewards", { ref, student_id: rows[0].id, kind: String(kind || "chapter").slice(0, 20), label: String(label || "Study & Stack reward").slice(0, 120), amount_sats: amount });
    res.json({ matched: true, status: "pending" });
  } catch (e) { console.error("stack-reward error:", e.message); res.status(500).json({ error: "Failed" }); }
});

app.get("/integrations/stack-reward-status", async (req, res) => {
  try {
    if (!stackKeyOk(req)) return res.status(401).json({ error: "Not allowed" });
    const refs = String(req.query.refs || "").split(",").filter(r => REF_OK.test(r)).slice(0, 200);
    if (!refs.length) return res.json([]);
    await settleRewards();
    res.json(await supabase("GET", "stack_rewards", null, `?ref=in.(${refs.join(",")})&select=ref,status`));
  } catch (e) { console.error("stack-reward-status error:", e.message); res.status(500).json({ error: "Failed" }); }
});

// Admin: the list shown on the payout page.
app.get("/rewards", ADMIN_ONLY, async (req, res) => {
  try {
    await settleRewards();
    const rows = await supabase("GET", "stack_rewards", null, "?select=id,student_id,kind,label,amount_sats,status,created_at,decided_at&order=created_at.desc&limit=200");
    const ids = [...new Set(rows.map(r => r.student_id))];
    const names = ids.length ? Object.fromEntries((await supabase("GET", "students", null, `?id=in.(${ids.join(",")})&select=id,name`)).map(s => [s.id, s.name])) : {};
    res.json(rows.map(r => ({ ...r, student_name: names[r.student_id] || "Unknown" })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/rewards/:id/approve", ADMIN_ONLY, async (req, res) => {
  try {
    const id = req.params.id;
    if (!REF_OK.test(id)) return res.status(400).json({ error: "Bad id" });
    const done = await supabase("PATCH", "stack_rewards", { status: "approved", decided_at: new Date().toISOString() }, `?id=eq.${id}&status=eq.pending`);
    if (!done.length) return res.status(409).json({ error: "That reward is no longer waiting for approval." });
    const r = done[0];
    try {
      const [st] = await supabase("GET", "students", null, `?id=eq.${r.student_id}&select=bonus`);
      await supabase("PATCH", "students", { bonus: (st.bonus || 0) + r.amount_sats }, `?id=eq.${r.student_id}`);
    } catch (e) {
      await supabase("PATCH", "stack_rewards", { status: "pending", decided_at: null }, `?id=eq.${id}`).catch(() => {});
      return res.status(500).json({ error: "Could not add the sats to the student. Nothing was changed." });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/rewards/:id/reject", ADMIN_ONLY, async (req, res) => {
  try {
    const id = req.params.id;
    if (!REF_OK.test(id)) return res.status(400).json({ error: "Bad id" });
    const done = await supabase("PATCH", "stack_rewards", { status: "rejected", decided_at: new Date().toISOString() }, `?id=eq.${id}&status=eq.pending`);
    if (!done.length) return res.status(409).json({ error: "That reward is no longer waiting for approval." });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Public pages (no login): only first names/ids and day counts — never payment details or Lightning addresses.
app.get("/public/leaderboard", async (req, res) => {
  try {
    const students = await supabase("GET", "students", null, "?select=id,name");
    const att = await supabase("GET", "attendance", null, "?select=student_id&present=eq.true");
    const days = {};
    att.forEach(a => { days[a.student_id] = (days[a.student_id] || 0) + 1; });
    res.json(students.map(s => ({ id: s.id, name: s.name, days: days[s.id] || 0 })));
  } catch (e) { res.status(500).json({ error: "Unavailable" }); }
});

app.get("/public/alumni", async (req, res) => {
  try {
    const students = await supabase("GET", "students", null, "?graduated=eq.true&order=graduated_at.asc&select=id,name,graduated_at");
    const att = await supabase("GET", "attendance", null, "?select=student_id");
    const days = {};
    att.forEach(a => { days[a.student_id] = (days[a.student_id] || 0) + 1; });
    res.json(students.map(s => ({ name: s.name, graduated_at: s.graduated_at, days: days[s.id] || 0 })));
  } catch (e) { res.status(500).json({ error: "Unavailable" }); }
});

// ═══════════════════════════════════════════════════════════════
// PUBLIC ALUMNI ENDPOINT — new self-contained addition to server.js
// Only exposes safe, public info — no Lightning addresses, no payments.
// ═══════════════════════════════════════════════════════════════
 
app.get("/alumni", async (req, res) => {
  try {
    const studentsRaw = await supabase("GET", "students", null, "?status=eq.alumni&order=graduated_at.desc");
    const attendanceRaw = await supabase("GET", "attendance", null, "");
 
    const SATS = 500;
    const alumni = studentsRaw.map(s => {
      const days = attendanceRaw.filter(a => a.student_id === s.id).length;
      return {
        name: s.name,
        cohort: s.cohort || "Bitcoin Ekasi",
        graduatedAt: s.graduated_at || null,
        totalDays: days,
        totalSats: days * SATS + (s.bonus || 0)
      };
    });
 
    res.json({ count: alumni.length, alumni });
  } catch (e) {
    console.error("Public alumni fetch error:", e.message);
    res.status(500).json({ error: e.message });
  }
});
 
 
// ── Blink test ──
app.post("/test", ANY_LOGIN, async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: "Missing API key" });
  try {
    const { ok, data } = await safeFetch(BLINK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({ query: "{ me { defaultAccount { wallets { id walletCurrency balance } } } }" })
    });
    if (data.errors?.length) return res.status(400).json({ error: data.errors[0].message });
    const wallets = data?.data?.me?.defaultAccount?.wallets || [];
    const btc = wallets.find(w => w.walletCurrency === "BTC");
    if (!btc) return res.status(400).json({ error: "No BTC wallet found" });
    res.json({ success: true, balance: btc.balance, walletId: btc.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Payment idempotency guard ────────────────────────────────────────────
// Prevents the same record (e.g. one student's payout) from being paid
// twice: either by a concurrent double-click ("Pay All Outstanding" /
// "Pay" clicked again while a run is still in flight), or by retrying a
// request that actually succeeded server-side but looked like it failed
// client-side (e.g. a slow Bolt Card / LNURL round-trip that outran the
// frontend's 30s abort timeout). Opt-in via payTable/payId/expectedPaid —
// callers that don't pass those get the old, unguarded behavior.
// See claude/diploma-payment-double-pay-bug.md for the incident this
// closes (7 of 9 diploma students paid twice on 18 Sept 2026).
const paymentLocks = new Set();

// Fire-and-forget audit row in the `payments` table (see migration
// create_payments_audit_log). Never throws — a logging failure must never
// block or fail a real payment. This is what makes an incident like the
// 18 Sept double-pay fully reconstructable next time: exact amount,
// destination, and whether it was sent or blocked as a duplicate.
function logPayment(opts) {
  const { payTable, payId, recipientLabel, destination, amount, event, blinkStatus, detail } = opts;
  supabase("POST", "payments", {
    pay_table: payTable || null,
    pay_id: payId || null,
    recipient_name: recipientLabel || null,
    destination: destination || null,
    amount: parseInt(amount) || 0,
    event,
    blink_status: blinkStatus || null,
    detail: detail || null
  }).catch(e => console.error("payments audit log insert failed:", e.message));
}

// After Blink confirms a payment, this is the single place that writes
// the new `paid` total — the backend is now the source of truth, not the
// frontend, so a client crash/reload/second click can no longer race the
// bookkeeping.
async function recordPaymentAndRespond(res, opts) {
  const { hasGuard, payTable, payId, expectedPaid, amount, status, destination, recipientLabel } = opts;
  if (!hasGuard) {
    logPayment({ destination, amount, event: "sent", blinkStatus: status, recipientLabel });
    return res.json({ success: true, status });
  }
  const newPaid = expectedPaid + parseInt(amount);
  logPayment({ payTable, payId, recipientLabel, destination, amount, event: "sent", blinkStatus: status });
  try {
    await supabase("PATCH", payTable, { paid: newPaid }, `?id=eq.${payId}`);
    return res.json({ success: true, status, newPaid });
  } catch (e) {
    console.error(`Paid ${destination} but failed to record paid total:`, e.message);
    await sendAlert(
      "Bitcoin Ekasi - Payment sent but NOT recorded",
      `<div style="font-family:Arial,sans-serif">Payment of ${amount} sats to ${recipientLabel || destination} succeeded, but updating ${payTable}.paid afterwards failed: ${e.message}. Please check and update it manually — otherwise this student/staff member may look unpaid and get paid again for the same amount.</div>`
    ).catch(() => {});
    return res.json({ success: true, status, recordWarning: "Payment sent, but the paid total could not be updated automatically. Check your email and update it manually." });
  }
}

// ── Blink pay ──
app.post("/pay", ANY_LOGIN, async (req, res) => {
  const { apiKey, destination, amount, memo, staffName, whatsappNumber, callmebotApikey, telegramChatId, payTable, payId, expectedPaid, recipientLabel } = req.body;
  if (!apiKey || !destination || !amount) {
    return res.status(400).json({ error: "Missing fields" });
  }

  // Default memo if none provided
  const paymentMemo = memo || "Bitcoin Ekasi - Mossel Bay";

  console.log(`Pay request: destination=${destination.slice(0,30)}... amount=${amount} memo="${paymentMemo}"`);

  const hasGuard = !!(payTable && payId && typeof expectedPaid === "number");
  const lockKey = hasGuard ? `${payTable}:${payId}` : null;

  if (lockKey) {
    if (paymentLocks.has(lockKey)) {
      logPayment({ payTable, payId, recipientLabel, destination, amount, event: "blocked_in_flight", detail: "A payment for this record was already in progress when this request arrived." });
      return res.status(409).json({ error: "A payment for this record is already in progress. Wait for it to finish before retrying." });
    }
    paymentLocks.add(lockKey);
  }

  try {
    if (hasGuard) {
      let currentPaid;
      try {
        const rows = await supabase("GET", payTable, null, `?id=eq.${payId}&select=paid`);
        currentPaid = rows[0] ? (rows[0].paid || 0) : null;
      } catch (e) {
        return res.status(500).json({ error: "Could not verify current paid total before sending payment: " + e.message });
      }
      if (currentPaid === null) {
        return res.status(400).json({ error: `No ${payTable} record found for id ${payId}` });
      }
      if (currentPaid !== expectedPaid) {
        const staleDetail = `paid is now ${currentPaid}, caller expected ${expectedPaid} — likely already paid`;
        logPayment({ payTable, payId, recipientLabel, destination, amount, event: "blocked_stale", detail: staleDetail });
        return res.status(409).json({
          error: `This record's paid total already changed (now ${currentPaid}, expected ${expectedPaid}) — most likely this payment already went through. Refresh and check before retrying.`,
          currentPaid
        });
      }
    }

    // Get BTC wallet ID
    const meRes = await safeFetch(BLINK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({ query: "{ me { defaultAccount { wallets { id walletCurrency } } } }" })
    });
    if (meRes.data.errors?.length) return res.status(400).json({ error: meRes.data.errors[0].message });
    const wallets = meRes.data?.data?.me?.defaultAccount?.wallets || [];
    const btcWallet = wallets.find(w => w.walletCurrency === "BTC");
    if (!btcWallet) return res.status(400).json({ error: "No BTC wallet found" });
 
    const dest = destination.trim();
    const isLnAddress = dest.includes("@");
    const isLnurl = dest.toLowerCase().startsWith("lnurl");
 
    // ── Lightning Address ──────────────────────────────────────────────────
    if (isLnAddress) {
      console.log("Paying via Lightning Address:", dest);
      const { data } = await safeFetch(BLINK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
        body: JSON.stringify({
          query: `mutation LnAddressPaymentSend($input: LnAddressPaymentSendInput!) {
            lnAddressPaymentSend(input: $input) { status errors { message code } }
          }`,
          variables: {
            input: {
              walletId: btcWallet.id,
              lnAddress: dest,
              amount: parseInt(amount)
            }
          }
        })
      });
      console.log("Blink LnAddress response:", JSON.stringify(data).slice(0, 500));
      if (data.errors?.length) return res.status(400).json({ error: data.errors.map(e => e.message).join(", ") });
      const result = data?.data?.lnAddressPaymentSend;
      if (result?.errors?.length) return res.status(400).json({ error: result.errors.map(e => e.message + (e.code ? " (" + e.code + ")" : "")).join(", ") });
      if (["SUCCESS", "ALREADY_PAID", "PENDING"].includes(result?.status)) {
        if (whatsappNumber && callmebotApikey) {
          sendWhatsAppPayment(whatsappNumber, callmebotApikey, staffName || "Staff", parseInt(amount)).catch(() => {});
        }
        if (telegramChatId) {
          sendTelegramPayment(telegramChatId, staffName || "Staff", parseInt(amount)).catch(() => {});
        }
        return await recordPaymentAndRespond(res, { hasGuard, payTable, payId, expectedPaid, amount, status: result.status, destination, recipientLabel });
      }
      const errMsg = "Payment status: " + result?.status;
      logPayment({ payTable, payId, recipientLabel, destination, amount, event: "failed", blinkStatus: result?.status, detail: errMsg });
      await payFailEmail(destination, "Lightning Address", parseInt(amount), errMsg).catch(() => {});
      return res.status(400).json({ error: errMsg });
    }
 
    // ── LNURL / Bolt Card ─────────────────────────────────────────────────
    if (isLnurl) {
      console.log("Paying via LNURL (Bolt Card)");
 
      // Step 1: decode LNURL → callback URL
      const callbackUrl = decodeLnurl(dest);
      console.log("LNURL decoded to:", callbackUrl);
 
      // Step 2: fetch LNURL-pay params
      const lnurlRes = await safeFetch(callbackUrl);
      if (lnurlRes.data.status === "ERROR") {
        return res.status(400).json({ error: "LNURL error: " + lnurlRes.data.reason });
      }
      const { callback, minSendable, maxSendable } = lnurlRes.data;
      const amountMsat = parseInt(amount) * 1000;
      const minSat = Math.ceil(minSendable / 1000);
      const maxSat = Math.floor(maxSendable / 1000);
 
      console.log(`LNURL range: ${minSat}–${maxSat} sats, requesting: ${amount} sats`);
 
      if (parseInt(amount) < minSat || parseInt(amount) > maxSat) {
        return res.status(400).json({
          error: `Amount ${amount} sats out of allowed range (${minSat}–${maxSat} sats)`
        });
      }
 
      // Step 3: fetch invoice from LNURL callback — include memo as comment
      const encodedMemo = encodeURIComponent(paymentMemo);
      const invoiceUrl = `${callback}${callback.includes("?") ? "&" : "?"}amount=${amountMsat}&comment=${encodedMemo}`;
      const invoiceRes = await safeFetch(invoiceUrl);
      if (invoiceRes.data.status === "ERROR") {
        return res.status(400).json({ error: "Invoice error: " + invoiceRes.data.reason });
      }
      const paymentRequest = invoiceRes.data.pr;
      if (!paymentRequest) {
        return res.status(400).json({ error: "No invoice received from Bolt Card" });
      }
      console.log("Got invoice, paying via Blink...");
 
      // Step 4: pay the invoice via Blink — include memo
      const { data: payData } = await safeFetch(BLINK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
        body: JSON.stringify({
          query: `mutation LnInvoicePaymentSend($input: LnInvoicePaymentInput!) {
            lnInvoicePaymentSend(input: $input) { status errors { message code } }
          }`,
          variables: {
            input: {
              walletId: btcWallet.id,
              paymentRequest,
              memo: paymentMemo
            }
          }
        })
      });
      if (payData.errors?.length) return res.status(400).json({ error: payData.errors[0].message });
      const payResult = payData?.data?.lnInvoicePaymentSend;
      if (payResult?.errors?.length) return res.status(400).json({ error: payResult.errors[0].message });
      if (["SUCCESS", "ALREADY_PAID", "PENDING"].includes(payResult?.status)) {
        if (whatsappNumber && callmebotApikey) {
          sendWhatsAppPayment(whatsappNumber, callmebotApikey, staffName || "Staff", parseInt(amount)).catch(() => {});
        }
        if (telegramChatId) {
          sendTelegramPayment(telegramChatId, staffName || "Staff", parseInt(amount)).catch(() => {});
        }
        return await recordPaymentAndRespond(res, { hasGuard, payTable, payId, expectedPaid, amount, status: payResult.status, destination, recipientLabel });
      }
      const boltErrMsg = "Payment failed: " + payResult?.status;
      logPayment({ payTable, payId, recipientLabel, destination, amount, event: "failed", blinkStatus: payResult?.status, detail: boltErrMsg });
      await payFailEmail(destination, "Bolt Card / LNURL", parseInt(amount), boltErrMsg).catch(() => {});
      return res.status(400).json({ error: boltErrMsg });
    }
 
    return res.status(400).json({ error: "Unknown destination format. Use Lightning Address (name@domain) or LNURL." });
 
  } catch (e) {
    console.error("Pay error:", e.message);
    logPayment({ payTable, payId, recipientLabel, destination, amount, event: "failed", detail: e.message });
    await payFailEmail(destination, "Lightning Payment", parseInt(amount) || 0, e.message).catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    if (lockKey) paymentLocks.delete(lockKey);
  }
});
// ═══════════════════════════════════════════════════════════════
// WEEKLY RECAP SHAREABLE IMAGE — new self-contained addition to server.js
// Does NOT touch any existing function. Monday–Friday week.
// ═══════════════════════════════════════════════════════════════
 
app.get("/weekly-recap.svg", async (req, res) => {
  try {
    const studentsRaw = await supabase("GET", "students", null, "?order=created_at.asc");
    const attendanceRaw = await supabase("GET", "attendance", null, "?order=date.desc");
    const staffRaw = await supabase("GET", "staff", null, "");
    const staffAttRaw = await supabase("GET", "staff_attendance", null, "");
 
    const todayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" });
    const today = todayFmt.format(new Date());
    const todayDate = new Date(today + "T00:00:00Z");
    const dow = todayDate.getUTCDay();
    const diffToMon = (dow === 0) ? -6 : -(dow - 1);
    const mon = new Date(todayDate);
    mon.setUTCDate(mon.getUTCDate() + diffToMon);
    const weekDates = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(mon);
      d.setUTCDate(d.getUTCDate() + i);
      weekDates.push(d.toISOString().split("T")[0]);
    }
 
    const weekLabelStart = new Date(weekDates[0] + "T00:00:00Z");
    const weekLabelEnd = new Date(weekDates[4] + "T00:00:00Z");
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const weekLabel = weekLabelStart.getUTCDate() + " " + monthNames[weekLabelStart.getUTCMonth()] + " \u2013 " + weekLabelEnd.getUTCDate() + " " + monthNames[weekLabelEnd.getUTCMonth()] + " " + weekLabelEnd.getUTCFullYear();
 
    const SATS = 500;
    const STAFF_SATS_PER_HOUR = 1300;
    const activeStudents = studentsRaw.filter(s => !s.status || s.status === "active");
 
    let totalWeekDays = 0;
    let totalWeekSats = 0;
    let perfectCount = 0;
    let mostImproved = null;
    activeStudents.forEach(s => {
      const days = attendanceRaw.filter(a => a.student_id === s.id && weekDates.includes(a.date)).length;
      totalWeekDays += days;
      totalWeekSats += days * SATS;
      if (days >= 5) perfectCount++;
    });
    const activeCount = activeStudents.filter(s => attendanceRaw.some(a => a.student_id === s.id && weekDates.includes(a.date))).length;
    const weekAttRate = activeStudents.length > 0 ? Math.round((totalWeekDays / (activeStudents.length * 5)) * 100) : 0;
 
    let staffWeekHours = 0;
    let topStaff = null;
    staffRaw.forEach(s => {
      const hrs = staffAttRaw.filter(a => a.staff_id === s.id && weekDates.includes(a.date)).reduce((sum, a) => sum + parseFloat(a.hours || 0), 0);
      staffWeekHours += hrs;
      if (hrs > 0 && (!topStaff || hrs > topStaff.hours)) topStaff = { name: s.name, hours: hrs };
    });
    const staffWeekEarned = Math.round(staffWeekHours * STAFF_SATS_PER_HOUR);
    const totalSpent = totalWeekSats + staffWeekEarned;
 
    function esc(str) {
      return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
 
    const shoutouts = [];
    if (topStaff) shoutouts.push(`Top Staff: ${esc(topStaff.name)} (${topStaff.hours.toFixed(1)} hrs)`);
    const shoutoutText = shoutouts.join("    \u2022    ");
 
    const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0A0A0F"/>
      <stop offset="100%" stop-color="#16161F"/>
    </linearGradient>
    <linearGradient id="orangeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#F7931A"/>
      <stop offset="100%" stop-color="#E87D0D"/>
    </linearGradient>
  </defs>
 
  <rect width="1200" height="630" fill="url(#bgGrad)"/>
  <rect x="0" y="0" width="1200" height="8" fill="url(#orangeGrad)"/>
 
  <text x="60" y="95" font-family="Arial, sans-serif" font-size="26" font-weight="800" fill="#F7931A" letter-spacing="4">BITCOIN EKASI</text>
  <text x="60" y="150" font-family="Arial, sans-serif" font-size="52" font-weight="800" fill="#F0F0F8">Weekly Recap</text>
  <text x="60" y="188" font-family="monospace" font-size="20" fill="#9090A8">${esc(weekLabel)}</text>
 
  <rect x="60" y="230" width="330" height="160" rx="16" fill="#111118" stroke="#1C1C28" stroke-width="1"/>
  <text x="225" y="315" font-family="Arial, sans-serif" font-size="56" font-weight="800" fill="#F7931A" text-anchor="middle">${activeCount}/${activeStudents.length}</text>
  <text x="225" y="355" font-family="Arial, sans-serif" font-size="16" fill="#55556A" text-anchor="middle" letter-spacing="2">ATTENDED THIS WEEK</text>
 
  <rect x="410" y="230" width="330" height="160" rx="16" fill="#111118" stroke="#1C1C28" stroke-width="1"/>
  <text x="575" y="315" font-family="Arial, sans-serif" font-size="56" font-weight="800" fill="#F7931A" text-anchor="middle">${weekAttRate}%</text>
  <text x="575" y="355" font-family="Arial, sans-serif" font-size="16" fill="#55556A" text-anchor="middle" letter-spacing="2">ATTENDANCE RATE</text>
 
  <rect x="760" y="230" width="380" height="160" rx="16" fill="#111118" stroke="#1C1C28" stroke-width="1"/>
  <text x="950" y="315" font-family="Arial, sans-serif" font-size="52" font-weight="800" fill="#F7931A" text-anchor="middle">\u26A1${totalSpent.toLocaleString()}</text>
  <text x="950" y="355" font-family="Arial, sans-serif" font-size="16" fill="#55556A" text-anchor="middle" letter-spacing="2">SATS EARNED THIS WEEK</text>
 
  <rect x="60" y="415" width="1080" height="90" rx="16" fill="rgba(16,185,129,0.06)" stroke="rgba(16,185,129,0.2)" stroke-width="1"/>
  <text x="600" y="450" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#10B981" text-anchor="middle">\uD83C\uDFC6 ${perfectCount} Perfect Attendance ${perfectCount === 1 ? "Student" : "Students"} This Week</text>
  <text x="600" y="482" font-family="Arial, sans-serif" font-size="15" fill="#9090A8" text-anchor="middle">${shoutoutText ? esc(shoutoutText) : "Keep showing up \u2014 every day counts!"}</text>
 
  <text x="60" y="580" font-family="Arial, sans-serif" font-size="16" fill="#55556A">Bitcoin Ekasi \u00B7 Mossel Bay, South Africa</text>
  <text x="1140" y="580" font-family="Arial, sans-serif" font-size="16" fill="#F7931A" text-anchor="end" font-weight="700">\u26A1 Powered by Lightning</text>
</svg>`;
 
    res.setHeader("Content-Type", "image/svg+xml");
    res.send(svg);
  } catch (e) {
    console.error("Weekly recap image error:", e.message);
    res.status(500).send("Error generating image: " + e.message);
  }
});
 
 
 
// ── Daily Summary Email (7pm SAST = 5pm UTC) ─────────────────
async function sendDailySummary() {
  console.log("Sending daily summary email...");
  try {
    // Fetch all data from Supabase
    const studentsRaw = await supabase("GET", "students", null, "?order=created_at.asc");
    const attendanceRaw = await supabase("GET", "attendance", null, "?order=date.desc");
    const staffRaw = await supabase("GET", "staff", null, "");
    const staffAttRaw = await supabase("GET", "staff_attendance", null, "");
    const excusesRaw = await supabase("GET", "excuses", null, "?order=date.desc");
   
    const pgStudentsRaw = await supabase("GET", "postgrad_students", null, "?status=eq.active&order=created_at.asc");
    const pgAttendanceRaw = await supabase("GET", "postgrad_attendance", null, "");
    const pgExcusesRaw = await supabase("GET", "postgrad_excuses", null, "");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const todayFormatted = new Date().toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "long", year: "numeric", month: "long", day: "numeric" });
 
    // Today's attendance
    const todayAtt = attendanceRaw.filter(a => a.date === today);
    const activeStudents = studentsRaw.filter(s => !s.status || s.status === "active");
    const presentIds = new Set(todayAtt.map(a => a.student_id));
    const presentStudents = activeStudents.filter(s => presentIds.has(s.id));
    const absentStudents = activeStudents.filter(s => !presentIds.has(s.id));
 
    // Today's excuses
    const todayExcuses = excusesRaw.filter(e => e.date === today);
    const excusedIds = new Set(todayExcuses.map(e => e.student_id));
 
    // Staff hours today
    const todayStaffAtt = staffAttRaw.filter(a => a.date === today);
    const todayPGAtt = pgAttendanceRaw.filter(a => a.date === today);
    const pgPresentIds = new Set(todayPGAtt.map(a => a.student_id));
    const pgPresentCount = pgStudentsRaw.filter(s => pgPresentIds.has(s.id)).length;
 
    // Sats owed
    const SATS = 500;
    const STAFF_SATS_PER_HOUR = 1300;
    const SHACK_SATS = 28000;
 
    let studentOwed = 0;
    activeStudents.forEach(s => {
      const attDays = attendanceRaw.filter(a => a.student_id === s.id).length;
      const earned = attDays * SATS + (s.bonus || 0);
      studentOwed += Math.max(0, earned - (s.paid || 0));
    });
 
    let staffOwed = 0;
    staffRaw.forEach(s => {
      const hours = staffAttRaw.filter(a => a.staff_id === s.id).reduce((sum, a) => sum + parseFloat(a.hours || 0), 0);
      const earned = Math.round(hours * STAFF_SATS_PER_HOUR);
      staffOwed += Math.max(0, earned - (s.paid || 0));
    });
 
    const attRate = activeStudents.length > 0 ? Math.round((presentStudents.length / activeStudents.length) * 100) : 0;
 
    // Build HTML email
    const presentRows = presentStudents.map(s =>
      '<tr><td style="padding:8px 12px;border-bottom:1px solid #1C1C28;color:#F7931A;font-weight:600">' + s.name + '</td><td style="padding:8px 12px;border-bottom:1px solid #1C1C28;text-align:right;color:#10B981">&#10003; Present</td></tr>'
    ).join("");
 
    const absentRows = absentStudents.map(s => {
      const excuse = todayExcuses.find(e => e.student_id === s.id);
      const status = excuse ? '<span style="color:#60A5FA">' + excuse.reason.split(" ")[0] + " " + excuse.reason.split(" ")[1] + "</span>" : '<span style="color:#F87171">&#10007; Absent</span>';
      return '<tr><td style="padding:8px 12px;border-bottom:1px solid #1C1C28;color:#F7931A;font-weight:600">' + s.name + '</td><td style="padding:8px 12px;border-bottom:1px solid #1C1C28;text-align:right">' + status + '</td></tr>';
    }).join("");
    
        const pgRows = pgStudentsRaw.length > 0 ? pgStudentsRaw.map(s => {
      const present = pgPresentIds.has(s.id);
      const excuse = pgExcusesRaw.find(e => e.student_id === s.id && e.date === today);
      let statusHtml;
      if (present) {
        statusHtml = '<span style="color:#10B981">&#10003; Present</span>';
      } else if (excuse) {
        statusHtml = '<span style="color:#60A5FA">' + excuse.reason + '</span>';
      } else {
        statusHtml = '<span style="color:#F87171">&#10007; Absent</span>';
      }
      return '<tr><td style="padding:8px 12px;border-bottom:1px solid #1C1C28;color:#C084FC;font-weight:600">' + s.name + '</td><td style="padding:8px 12px;border-bottom:1px solid #1C1C28;text-align:right">' + statusHtml + '</td></tr>';
    }).join("") : '<tr><td colspan="2" style="padding:12px;color:#55556A;text-align:center">No postgrad students enrolled</td></tr>';
 
    const staffRows = todayStaffAtt.length > 0 ? todayStaffAtt.map(a => {
      const staff = staffRaw.find(s => s.id === a.staff_id);
      return '<tr><td style="padding:8px 12px;border-bottom:1px solid #1C1C28;color:#6366F1;font-weight:600">' + (staff ? staff.name : "Unknown") + '</td><td style="padding:8px 12px;border-bottom:1px solid #1C1C28;text-align:right;color:#F0F0F8">' + a.hours + ' hrs</td></tr>';
    }).join("") : '<tr><td colspan="2" style="padding:12px;color:#55556A;text-align:center">No hours logged today</td></tr>';
 
    const html = [
      // Stats strip
 
      // Stats strip
      '<div style="display:flex;border-bottom:1px solid #1C1C28">',
      '<div style="flex:1;padding:18px;text-align:center;border-right:1px solid #1C1C28">',
      '<div style="font-size:28px;font-weight:800;color:#F7931A;font-family:monospace">' + presentStudents.length + '/' + activeStudents.length + '</div>',
      '<div style="font-size:10px;color:#55556A;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Present Today</div>',
      '</div>',
      '<div style="flex:1;padding:18px;text-align:center;border-right:1px solid #1C1C28">',
      '<div style="font-size:28px;font-weight:800;color:#F7931A;font-family:monospace">' + attRate + '%</div>',
      '<div style="font-size:10px;color:#55556A;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Attendance Rate</div>',
      '</div>',
      '<div style="flex:1;padding:18px;text-align:center">',
      '<div style="font-size:28px;font-weight:800;color:#F7931A;font-family:monospace">&#9889;' + (studentOwed + staffOwed).toLocaleString() + '</div>',
      '<div style="font-size:10px;color:#55556A;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Sats Owed</div>',
      '</div>',
      '</div>',
 
      // Attendance table
      '<div style="padding:20px 24px">',
      '<div style="font-size:11px;font-weight:700;color:#9090A8;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">Today&#39;s Attendance</div>',
      '<table style="width:100%;border-collapse:collapse;background:#111118;border-radius:10px;overflow:hidden">',
      presentRows,
      absentRows,
      '</table>',
      '</div>',
 
      // Staff table
      '<div style="padding:0 24px 20px">',
      '<div style="font-size:11px;font-weight:700;color:#9090A8;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">Staff Hours Today</div>',
      '<table style="width:100%;border-collapse:collapse;background:#111118;border-radius:10px;overflow:hidden">',
      staffRows,
      '</table>',
      '</div>',
      '<div style="padding:0 24px 20px">',
      '<div style="font-size:11px;font-weight:700;color:#9090A8;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">🎓 Postgrad Attendance Today (' + pgPresentCount + '/' + pgStudentsRaw.length + ')</div>',
      '<table style="width:100%;border-collapse:collapse;background:#111118;border-radius:10px;overflow:hidden">',
      pgRows,
      '</table>',
      '</div>',
 
      // Footer
      '<div style="padding:16px 24px;border-top:1px solid #1C1C28;text-align:center">',
      '<a href="https://luthandosabtc.github.io/bitcoinekasi/" style="display:inline-block;background:#F7931A;color:#000;padding:12px 28px;border-radius:8px;font-weight:700;text-decoration:none;font-size:13px">Open Bitcoin Ekasi App</a>',
      '<div style="font-size:11px;color:#55556A;margin-top:14px">Bitcoin Ekasi · Mossel Bay · Powered by Lightning &#9889;</div>',
      '</div>',
 
      '</div>'
    ].join("");
 
    await sendAlert("Bitcoin Ekasi Daily Summary — " + todayFormatted, html, DAILY_SUMMARY_CC);
    console.log("Daily summary sent successfully");
  } catch(e) {
    console.error("Daily summary failed:", e.message);
    await sendAlert("Bitcoin Ekasi — Daily Summary Failed", "<p>Could not generate daily summary: " + e.message + "</p>", DAILY_SUMMARY_CC);
  }
}
 
// Schedule: Monday–Friday at 5pm UTC (7pm SAST) — class days only
cron.schedule("0 17 * * 1-5", () => {
  console.log("Running daily summary cron job...");
  sendDailySummary();
}, { timezone: "UTC" });
 
cron.schedule("15 17 * * 5", () => {
  console.log("Running WhatsApp community recap...");
  postWeeklyRecapToWhatsApp();
}, { timezone: "UTC" });
 
// Test endpoint to trigger summary manually
app.get("/send-summary", ADMIN_ONLY, async (req, res) => {
  await sendDailySummary();
  res.json({ success: true, message: "Daily summary sent" });
});
 
app.get("/post-weekly-whatsapp", ADMIN_ONLY, async (req, res) => {
  await postWeeklyRecapToWhatsApp();
  res.json({ success: true, message: "Community recap sent to your WhatsApp — check your phone to forward it" });
});
async function postWeeklyRecapToWhatsApp() {
  console.log("Sending weekly community recap to WhatsApp...");
  if (!COMMUNITY_RECAP_WHATSAPP_NUMBER || !COMMUNITY_RECAP_CALLMEBOT_APIKEY) {
    console.log("No community recap WhatsApp credentials configured — skipping");
    return;
  }
  try {
    const studentsRaw = await supabase("GET", "students", null, "?order=created_at.asc");
    const attendanceRaw = await supabase("GET", "attendance", null, "?order=date.desc");
    const staffRaw = await supabase("GET", "staff", null, "");
    const staffAttRaw = await supabase("GET", "staff_attendance", null, "");
 
    const todayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" });
    const today = todayFmt.format(new Date());
    const todayDate = new Date(today + "T00:00:00Z");
    const dow = todayDate.getUTCDay();
    const diffToMon = (dow === 0) ? -6 : -(dow - 1);
    const mon = new Date(todayDate);
    mon.setUTCDate(mon.getUTCDate() + diffToMon);
    const weekDates = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(mon);
      d.setUTCDate(d.getUTCDate() + i);
      weekDates.push(d.toISOString().split("T")[0]);
    }
 
    const weekLabelStart = new Date(weekDates[0] + "T00:00:00Z");
    const weekLabelEnd = new Date(weekDates[4] + "T00:00:00Z");
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const weekLabel = weekLabelStart.getUTCDate() + " " + monthNames[weekLabelStart.getUTCMonth()] + "–" + weekLabelEnd.getUTCDate() + " " + monthNames[weekLabelEnd.getUTCMonth()] + " " + weekLabelEnd.getUTCFullYear();
 
    const SATS = 500;
    const STAFF_SATS_PER_HOUR = 1300;
    const activeStudents = studentsRaw.filter(s => !s.status || s.status === "active");
 
    let totalWeekDays = 0;
    let totalWeekSats = 0;
    let perfectCount = 0;
    const perfectNames = [];
    const studentEarnings = [];
    activeStudents.forEach(s => {
      const days = attendanceRaw.filter(a => a.student_id === s.id && weekDates.includes(a.date)).length;
      const sats = days * SATS;
      totalWeekDays += days;
      totalWeekSats += sats;
      if (days >= 4) { perfectCount++; perfectNames.push(s.name); }
      studentEarnings.push({ name: s.name, days, sats });
    });
    studentEarnings.sort((a, b) => b.sats - a.sats);
 
    const activeCount = activeStudents.filter(s => attendanceRaw.some(a => a.student_id === s.id && weekDates.includes(a.date))).length;
    const weekAttRate = activeStudents.length > 0 ? Math.round((totalWeekDays / (activeStudents.length * 4)) * 100) : 0;
 
    let staffWeekHours = 0;
    const staffEarnings = [];
    staffRaw.forEach(s => {
      const hrs = staffAttRaw.filter(a => a.staff_id === s.id && weekDates.includes(a.date)).reduce((sum, a) => sum + parseFloat(a.hours || 0), 0);
      staffWeekHours += hrs;
      staffEarnings.push({ name: s.name, hours: hrs, sats: Math.round(hrs * STAFF_SATS_PER_HOUR) });
    });
    staffEarnings.sort((a, b) => b.sats - a.sats);
    const staffWeekEarned = Math.round(staffWeekHours * STAFF_SATS_PER_HOUR);
    const totalSpent = totalWeekSats + staffWeekEarned;
 
    const staffEarningsLines = staffEarnings
      .filter(s => s.hours > 0)
      .map(s => s.name + " — " + s.hours.toFixed(1) + "h — ⚡" + s.sats.toLocaleString())
      .join("\n") || "No staff hours logged this week";
 
    const perfectBlock = perfectNames.length > 0
      ? "🏆 Perfect attendance: " + perfectNames.join(", ") + "\n\n"
      : "\n";
 
    const earningsLines = studentEarnings
      .map(s => s.name + " — " + s.days + (s.days === 1 ? " day" : " days") + " — ⚡" + s.sats.toLocaleString())
      .join("\n");
 
    const message =
`⚡ *Bitcoin Ekasi Weekly Recap*
${weekLabel}
 
👥 ${activeCount}/${activeStudents.length} students attended
📊 ${weekAttRate}% attendance rate
${perfectBlock}📋 *This Week's Earnings:*
${earningsLines}
 
👩‍🏫 *Teaching Team:*
${staffEarningsLines}
 
⚡ ${totalSpent.toLocaleString()} sats paid out this week
 
_Forward this to the community group 👇_`;
 
    const cleanNumber = COMMUNITY_RECAP_WHATSAPP_NUMBER.replace(/[\s+]/g, "");
    const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanNumber}&text=${encodeURIComponent(message)}&apikey=${COMMUNITY_RECAP_CALLMEBOT_APIKEY}`;
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) console.error("Community recap WhatsApp error:", text.slice(0, 200));
    else console.log("Community recap sent - ready to forward:", text.slice(0, 100));
  } catch (e) {
    console.error("Community recap failed:", e.message);
  }
}
 
cron.schedule("15 17 * * 5", () => {
  console.log("Running WhatsApp community recap...");
  postWeeklyRecapToWhatsApp();
}, { timezone: "UTC" });
function chunkMessage(text, maxLen = 600) {
  const paragraphs = text.split(/\n\n/);
  const chunks = [];
  let current = "";
  for (const p of paragraphs) {
    const candidate = current ? current + "\n\n" + p : p;
    if (candidate.length > maxLen && current) {
      chunks.push(current);
      current = p;
    } else {
      current = candidate;
    }
    while (current.length > maxLen) {
      chunks.push(current.slice(0, maxLen));
      current = current.slice(maxLen);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
app.post("/send-stakeholder-update", ADMIN_ONLY, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "Missing 'message' in request body" });
  if (!COMMUNITY_RECAP_WHATSAPP_NUMBER || !COMMUNITY_RECAP_CALLMEBOT_APIKEY) {
    return res.status(400).json({ error: "WhatsApp credentials not configured" });
  }
  try {
    const cleanNumber = COMMUNITY_RECAP_WHATSAPP_NUMBER.replace(/[\s+]/g, "");
    const chunks = chunkMessage(message, 600);
    for (let i = 0; i < chunks.length; i++) {
      const part = chunks.length > 1 ? `(${i + 1}/${chunks.length})\n\n${chunks[i]}` : chunks[i];
      const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanNumber}&text=${encodeURIComponent(part)}&apikey=${COMMUNITY_RECAP_CALLMEBOT_APIKEY}`;
      const r = await fetch(url);
      const text = await r.text();
      if (!r.ok) {
        console.error("Stakeholder update WhatsApp error on part " + (i + 1) + ":", text.slice(0, 200));
        return res.status(500).json({ error: "Failed on part " + (i + 1) + ": " + text.slice(0, 200) });
      }
      if (i < chunks.length - 1) await new Promise(resolve => setTimeout(resolve, 1500));
    }
    console.log("Stakeholder update sent in", chunks.length, "part(s)");
    res.json({ success: true, message: `Stakeholder update sent to WhatsApp in ${chunks.length} part(s)` });
  } catch (e) {
    console.error("Stakeholder update failed:", e.message);
    res.status(500).json({ error: e.message });
  }
});
 
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Ekasi backend running on port ${PORT}`));
 
// ═══════════════════════════════════════════════════════════════
// WEEKLY STAFF BONUS — new self-contained addition to server.js
// Does NOT touch any existing function. Grants 1,300 sats bonus
// to whoever logs the most hours each week (Tue-Fri).
// ═══════════════════════════════════════════════════════════════
 
const STAFF_BONUS_SATS = 1300;
 
async function grantWeeklyStaffBonus() {
  console.log("Checking weekly staff bonus...");
  try {
    const staffRaw = await supabase("GET", "staff", null, "");
    const staffAttRaw = await supabase("GET", "staff_attendance", null, "");
 
    const todayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" });
    const today = todayFmt.format(new Date());
    const todayDate = new Date(today + "T00:00:00Z");
    const dow = todayDate.getUTCDay();
    const diffToTue = (dow === 0) ? -5 : (dow === 1) ? -6 : -(dow - 2);
    const tue = new Date(todayDate);
    tue.setUTCDate(tue.getUTCDate() + diffToTue);
    const weekDates = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date(tue);
      d.setUTCDate(d.getUTCDate() + i);
      weekDates.push(d.toISOString().split("T")[0]);
    }
 
    if (!staffRaw.length) {
      console.log("No staff members found — skipping bonus check");
      return;
    }
 
    const staffHours = staffRaw.map(s => {
      const hours = staffAttRaw.filter(a => a.staff_id === s.id && weekDates.includes(a.date)).reduce((sum, a) => sum + parseFloat(a.hours || 0), 0);
      return { id: s.id, name: s.name, hours, whatsappNumber: s.whatsapp_number, callmebotApikey: s.callmebot_apikey, telegramChatId: s.telegram_chat_id, currentBonus: s.bonus || 0 };
    });
 
    const maxHours = Math.max(...staffHours.map(s => s.hours));
    if (maxHours <= 0) {
      console.log("No staff hours logged this week — skipping bonus");
      return;
    }
 
    const winners = staffHours.filter(s => s.hours === maxHours);
 
    for (const winner of winners) {
      const newBonus = winner.currentBonus + STAFF_BONUS_SATS;
      await supabase("PATCH", "staff", { bonus: newBonus }, "?id=eq." + winner.id);
      console.log("Bonus granted:", winner.name, "-", winner.hours, "hrs -", "+" + STAFF_BONUS_SATS, "sats");
 
      const congratsMessage = `\uD83C\uDFC6 Congratulations ${winner.name}! You logged the most hours this week (${winner.hours.toFixed(1)} hrs) and earned a \u26A1${STAFF_BONUS_SATS.toLocaleString()} sat bonus on top of your regular pay. Thank you for your dedication to Bitcoin Ekasi! \uD83C\uDF89`;
 
      if (winner.whatsappNumber && winner.callmebotApikey) {
        try {
          const cleanNumber = winner.whatsappNumber.replace(/[\s+]/g, "");
          const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanNumber}&text=${encodeURIComponent(congratsMessage)}&apikey=${winner.callmebotApikey}`;
          await fetch(url);
          console.log("Bonus WhatsApp notification sent to", winner.name);
        } catch (e) {
          console.error("Bonus WhatsApp notification failed for", winner.name, ":", e.message);
        }
      }
 
      if (winner.telegramChatId && TELEGRAM_BOT_TOKEN) {
        try {
          const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
          await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: winner.telegramChatId, text: congratsMessage })
          });
          console.log("Bonus Telegram notification sent to", winner.name);
        } catch (e) {
          console.error("Bonus Telegram notification failed for", winner.name, ":", e.message);
        }
      }
    }
 
    console.log("Weekly staff bonus complete. Winner(s):", winners.map(w => w.name).join(", "));
  } catch (e) {
    console.error("Weekly staff bonus failed:", e.message);
  }
}
 
// Schedule: Fridays, alongside the other weekly jobs
cron.schedule("20 17 * * 5", () => {
  console.log("Running weekly staff bonus check...");
  grantWeeklyStaffBonus();
}, { timezone: "UTC" });
 
// Manual test endpoint
app.get("/grant-staff-bonus", ADMIN_ONLY, async (req, res) => {
  await grantWeeklyStaffBonus();
  res.json({ success: true, message: "Staff bonus check triggered — check logs for the winner" });
});
 
// ── Weekly Summary Email (Fridays, 7pm SAST = 5pm UTC) ────────
async function sendWeeklySummary() {
  console.log("Sending weekly summary email...");
  try {
    const studentsRaw = await supabase("GET", "students", null, "?order=created_at.asc");
    const attendanceRaw = await supabase("GET", "attendance", null, "?order=date.desc");
    const staffRaw = await supabase("GET", "staff", null, "");
    const staffAttRaw = await supabase("GET", "staff_attendance", null, "");
 
    const todayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" });
    const today = todayFmt.format(new Date());
    const todayDate = new Date(today + "T00:00:00Z");
    const dow = todayDate.getUTCDay();
    const diffToMon = (dow === 0) ? -6 : -(dow - 1);
    const mon = new Date(todayDate);
    mon.setUTCDate(mon.getUTCDate() + diffToMon);
    const weekDates = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(mon);
      d.setUTCDate(d.getUTCDate() + i);
      weekDates.push(d.toISOString().split("T")[0]);
    }
 
    // Last week's dates, for comparison (most-improved calculation)
    const lastMon = new Date(mon);
    lastMon.setUTCDate(lastMon.getUTCDate() - 7);
    const lastWeekDates = [];
    for (let i = 0; i < 5; i++) {
    const d = new Date(lastMon);
    d.setUTCDate(d.getUTCDate() + i);
    lastWeekDates.push(d.toISOString().split("T")[0]);
    }
 
 
    const weekLabelStart = new Date(weekDates[0] + "T00:00:00Z");
    const weekLabelEnd = new Date(weekDates[4] + "T00:00:00Z");
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const weekLabel = weekLabelStart.getUTCDate() + " " + monthNames[weekLabelStart.getUTCMonth()] + " – " + weekLabelEnd.getUTCDate() + " " + monthNames[weekLabelEnd.getUTCMonth()] + " " + weekLabelEnd.getUTCFullYear();
 
    const SATS = 500;
    const STAFF_SATS_PER_HOUR = 1300;
 
    const activeStudents = studentsRaw.filter(s => !s.status || s.status === "active");
 
    let totalWeekDays = 0;
    let totalWeekSats = 0;
    const perfectStudents = [];
    let mostImproved = null; // { name, improvement, daysThisWeek, daysLastWeek }
    const studentRows = activeStudents.map(s => {
      const weekAtt = attendanceRaw.filter(a => a.student_id === s.id && weekDates.includes(a.date));
      const days = weekAtt.length;
      totalWeekDays += days;
      totalWeekSats += days * SATS;
      if (days >= 4) perfectStudents.push(s.name);
 
      const lastWeekAtt = attendanceRaw.filter(a => a.student_id === s.id && lastWeekDates.includes(a.date));
      const lastWeekDays = lastWeekAtt.length;
      const improvement = days - lastWeekDays;
      if (improvement > 0 && (!mostImproved || improvement > mostImproved.improvement)) {
        mostImproved = { name: s.name, improvement, daysThisWeek: days, daysLastWeek: lastWeekDays };
      }
 
      return { name: s.name, days };
    });
    const activeCount = studentRows.filter(s => s.days > 0).length;
    const avgDays = activeStudents.length > 0 ? (totalWeekDays / activeStudents.length).toFixed(1) : "0";
    const weekAttRate = activeStudents.length > 0 ? Math.round((totalWeekDays / (activeStudents.length * 4)) * 100) : 0;
 
    let staffWeekHours = 0;
    let topStaff = null; // { name, hours }
    staffRaw.forEach(s => {
      const hrs = staffAttRaw.filter(a => a.staff_id === s.id && weekDates.includes(a.date)).reduce((sum, a) => sum + parseFloat(a.hours || 0), 0);
      staffWeekHours += hrs;
      if (hrs > 0 && (!topStaff || hrs > topStaff.hours)) {
        topStaff = { name: s.name, hours: hrs };
      }
    });
    const staffWeekEarned = Math.round(staffWeekHours * STAFF_SATS_PER_HOUR);
 
    let totalOwed = 0;
    activeStudents.forEach(s => {
      const attDays = attendanceRaw.filter(a => a.student_id === s.id).length;
      const earned = attDays * SATS + (s.bonus || 0);
      totalOwed += Math.max(0, earned - (s.paid || 0));
    });
    staffRaw.forEach(s => {
      const hours = staffAttRaw.filter(a => a.staff_id === s.id).reduce((sum, a) => sum + parseFloat(a.hours || 0), 0);
      const earned = Math.round(hours * STAFF_SATS_PER_HOUR);
      totalOwed += Math.max(0, earned - (s.paid || 0));
    });
 
    const perfectListHtml = perfectStudents.length > 0
      ? perfectStudents.map(n => '<span style="display:inline-block;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);border-radius:100px;padding:4px 12px;font-size:11px;font-weight:600;color:#10B981;margin:3px">&#10003; ' + n + '</span>').join("")
      : '<span style="color:#55556A;font-size:12px">No perfect attendance this week</span>';
 
    const shoutoutsHtml = [];
    if (mostImproved) {
      shoutoutsHtml.push(
        '<div style="background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.2);border-radius:10px;padding:14px 16px;margin-bottom:10px">' +
        '<div style="font-size:11px;color:#9090A8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">&#128200; Most Improved</div>' +
        '<div style="font-size:15px;font-weight:700;color:#F0F0F8">' + mostImproved.name + '</div>' +
        '<div style="font-size:12px;color:#6366F1;margin-top:2px">' + mostImproved.daysLastWeek + ' &#8594; ' + mostImproved.daysThisWeek + ' days (+' + mostImproved.improvement + ')</div>' +
        '</div>'
      );
    }
    if (topStaff) {
      shoutoutsHtml.push(
        '<div style="background:rgba(247,147,26,0.06);border:1px solid rgba(247,147,26,0.2);border-radius:10px;padding:14px 16px;margin-bottom:10px">' +
        '<div style="font-size:11px;color:#9090A8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">&#11088; Top Staff Member</div>' +
        '<div style="font-size:15px;font-weight:700;color:#F0F0F8">' + topStaff.name + '</div>' +
        '<div style="font-size:12px;color:#F7931A;margin-top:2px">' + topStaff.hours.toFixed(1) + ' hours logged this week</div>' +
        '</div>'
      );
    }
 
    const html = [
      '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#0A0A0F;color:#F0F0F8;border-radius:16px;overflow:hidden">',
      '<div style="background:linear-gradient(135deg,#F7931A,#E87D0D);padding:28px 24px;text-align:center">',
      '<div style="font-size:36px;margin-bottom:8px">&#128203;</div>',
      '<div style="font-size:22px;font-weight:800;color:#000">Bitcoin Ekasi</div>',
      '<div style="font-size:14px;color:rgba(0,0,0,0.7);margin-top:4px">Weekly Summary — ' + weekLabel + '</div>',
      '</div>',
 
      '<div style="display:flex;border-bottom:1px solid #1C1C28">',
      '<div style="flex:1;padding:18px;text-align:center;border-right:1px solid #1C1C28">',
      '<div style="font-size:26px;font-weight:800;color:#F7931A;font-family:monospace">' + activeCount + '/' + activeStudents.length + '</div>',
      '<div style="font-size:10px;color:#55556A;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Attended This Week</div>',
      '</div>',
      '<div style="flex:1;padding:18px;text-align:center;border-right:1px solid #1C1C28">',
      '<div style="font-size:26px;font-weight:800;color:#F7931A;font-family:monospace">' + weekAttRate + '%</div>',
      '<div style="font-size:10px;color:#55556A;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Attendance Rate</div>',
      '</div>',
      '<div style="flex:1;padding:18px;text-align:center">',
      '<div style="font-size:26px;font-weight:800;color:#F7931A;font-family:monospace">' + avgDays + '</div>',
      '<div style="font-size:10px;color:#55556A;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Avg Days/Student</div>',
      '</div>',
      '</div>',
 
      shoutoutsHtml.length > 0 ? '<div style="padding:20px 24px 4px">' + shoutoutsHtml.join("") + '</div>' : '',
 
      '<div style="padding:20px 24px">',
      '<div style="font-size:11px;font-weight:700;color:#9090A8;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">&#127942; Perfect Attendance</div>',
      '<div>', perfectListHtml, '</div>',
      '</div>',
 
      '<div style="padding:0 24px 20px">',
      '<div style="font-size:11px;font-weight:700;color:#9090A8;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">This Week&#39;s Totals</div>',
      '<table style="width:100%;border-collapse:collapse;background:#111118;border-radius:10px;overflow:hidden">',
      '<tr><td style="padding:10px 14px;border-bottom:1px solid #1C1C28;color:#9090A8">Students Earned</td><td style="padding:10px 14px;border-bottom:1px solid #1C1C28;text-align:right;color:#F7931A;font-weight:700">&#9889;' + totalWeekSats.toLocaleString() + ' sats</td></tr>',
      '<tr><td style="padding:10px 14px;border-bottom:1px solid #1C1C28;color:#9090A8">Staff Hours Logged</td><td style="padding:10px 14px;border-bottom:1px solid #1C1C28;text-align:right;color:#6366F1;font-weight:700">' + staffWeekHours.toFixed(1) + ' hrs</td></tr>',
      '<tr><td style="padding:10px 14px;border-bottom:1px solid #1C1C28;color:#9090A8">Staff Sats Earned</td><td style="padding:10px 14px;border-bottom:1px solid #1C1C28;text-align:right;color:#6366F1;font-weight:700">&#9889;' + staffWeekEarned.toLocaleString() + ' sats</td></tr>',
      '<tr><td style="padding:10px 14px;color:#F0F0F8;font-weight:700">Total Sats Spent This Week</td><td style="padding:10px 14px;text-align:right;color:#10B981;font-weight:800">&#9889;' + (totalWeekSats + staffWeekEarned).toLocaleString() + ' sats</td></tr>',
      '</table>',
      '</div>',
 
      '<div style="padding:0 24px 20px">',
      '<div style="background:rgba(247,147,26,0.06);border:1px solid rgba(247,147,26,0.2);border-radius:10px;padding:14px 16px;text-align:center">',
      '<div style="font-size:11px;color:#9090A8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Total Owed Across Program</div>',
      '<div style="font-size:22px;font-weight:800;color:#F7931A;font-family:monospace">&#9889;' + totalOwed.toLocaleString() + ' sats</div>',
      '</div>',
      '</div>',
 
      '<div style="padding:16px 24px;border-top:1px solid #1C1C28;text-align:center">',
      '<a href="https://luthandosabtc.github.io/bitcoinekasi/" style="display:inline-block;background:#F7931A;color:#000;padding:12px 28px;border-radius:8px;font-weight:700;text-decoration:none;font-size:13px">Open Bitcoin Ekasi App</a>',
      '<div style="font-size:11px;color:#55556A;margin-top:14px">Bitcoin Ekasi · Mossel Bay · Powered by Lightning &#9889;</div>',
      '</div>',
 
      '</div>'
    ].join("");
 
    await sendAlert("Bitcoin Ekasi Weekly Summary — " + weekLabel, html);
    console.log("Weekly summary sent successfully");
  } catch(e) {
    console.error("Weekly summary failed:", e.message);
    await sendAlert("Bitcoin Ekasi — Weekly Summary Failed", "<p>Could not generate weekly summary: " + e.message + "</p>");
  }
}
 
// Schedule: every Friday at 5pm UTC (7pm SAST) — after the daily summary
cron.schedule("5 17 * * 5", () => {
  console.log("Running weekly summary cron job...");
  sendWeeklySummary();
}, { timezone: "UTC" });
 
// Test endpoint to trigger weekly summary manually
app.get("/send-weekly-summary", ADMIN_ONLY, async (req, res) => {
  await sendWeeklySummary();
  res.json({ success: true, message: "Weekly summary sent" });
});
