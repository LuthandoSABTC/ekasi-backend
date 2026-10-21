// staff-wallets.js — let the admin see a staff member's Blink wallet balance.
//
// Only with the staff member's agreement: they make a Blink API key with ONLY the
// "Read" scope and give it to the admin. The key is checked (read-only, and it works),
// then stored encrypted in `staff_wallet_keys`. That table is NOT reachable through
// the /db proxy, and the key itself never goes back to any page — only the balance.
//
// Needs WALLET_KEY_SECRET in .env (deploy/24-staff-wallets.sh creates it).
const crypto = require("crypto");

const BLINK_URL = "https://api.blink.sv/graphql";
const SECRET = process.env.WALLET_KEY_SECRET || "";
const CACHE_MS = 60 * 1000; // don't ask Blink more than once a minute per person
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function aesKey() { return crypto.createHash("sha256").update(SECRET).digest(); }

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", aesKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(":");
}

function decrypt(stored) {
  const [v, iv, tag, ct] = String(stored || "").split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Stored key is unreadable");
  const d = crypto.createDecipheriv("aes-256-gcm", aesKey(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

// One Blink GraphQL call with the staff member's key. Never logs or returns the key.
async function blink(fetch, apiKey, query) {
  let res, text;
  try {
    res = await fetch(BLINK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({ query }),
      timeout: 15000
    });
    text = await res.text();
  } catch (e) { throw new Error("Could not reach Blink"); }
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(`Blink answered strangely (HTTP ${res.status})`); }
  if (res.status === 401 || res.status === 403) throw new Error("Blink did not accept this key (it may have been deleted)");
  if (data.errors && data.errors.length) {
    const m = String(data.errors[0].message || "");
    if (/not authori[sz]ed|unauthori[sz]ed|invalid/i.test(m)) throw new Error("Blink did not accept this key (it may have been deleted)");
    throw new Error("Blink error: " + m.slice(0, 120));
  }
  if (!res.ok) throw new Error(`Blink error (HTTP ${res.status})`);
  return data.data || {};
}

const Q_SCOPES = "query { authorization { scopes } }";
const Q_WALLETS = "query { me { defaultAccount { wallets { walletCurrency balance pendingIncomingBalance } } } }";

function summarise(data) {
  const wallets = (((data.me || {}).defaultAccount || {}).wallets) || [];
  const out = { btcSats: 0, pendingSats: 0, usdCents: 0, hasUsdWallet: false };
  wallets.forEach((w) => {
    if (w.walletCurrency === "BTC") { out.btcSats += Number(w.balance) || 0; out.pendingSats += Number(w.pendingIncomingBalance) || 0; }
    if (w.walletCurrency === "USD") { out.hasUsdWallet = true; out.usdCents += Number(w.balance) || 0; }
  });
  return out;
}

module.exports = function setupStaffWallets(app, { supabase, ADMIN_ONLY, fetch }) {
  const cache = new Map(); // staffId -> { at, result }

  const ready = (req, res, next) => {
    if (!SECRET || SECRET.length < 32) return res.status(503).json({ error: "Wallet balances are not set up on the server yet (WALLET_KEY_SECRET missing)." });
    next();
  };
  const goodId = (req, res, next) => (UUID.test(req.params.staffId) ? next() : res.status(400).json({ error: "Unknown staff member" }));

  // Which staff have a linked wallet (no keys, no balances).
  app.get("/staff-wallets", ADMIN_ONLY, ready, async (req, res) => {
    try {
      const rows = await supabase("GET", "staff_wallet_keys", null, "?select=staff_id,key_hint,added_at");
      res.json(rows.map((r) => ({ staffId: r.staff_id, keyHint: r.key_hint, addedAt: r.added_at })));
    } catch (e) { res.status(500).json({ error: "Could not load linked wallets" }); }
  });

  // Live balances for everyone linked. ?fresh=1 skips the 1-minute cache.
  app.get("/staff-wallets/balances", ADMIN_ONLY, ready, async (req, res) => {
    try {
      const rows = await supabase("GET", "staff_wallet_keys", null, "?select=staff_id,key_enc");
      const fresh = req.query.fresh === "1";
      const out = await Promise.all(rows.map(async (r) => {
        const hit = cache.get(r.staff_id);
        if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.result;
        let result;
        try {
          result = { staffId: r.staff_id, ok: true, ...summarise(await blink(fetch, decrypt(r.key_enc), Q_WALLETS)), checkedAt: new Date().toISOString() };
        } catch (e) {
          result = { staffId: r.staff_id, ok: false, error: e.message, checkedAt: new Date().toISOString() };
        }
        cache.set(r.staff_id, { at: Date.now(), result });
        return result;
      }));
      res.json(out);
    } catch (e) { console.error("staff balances:", e.message); res.status(500).json({ error: "Could not check balances" }); }
  });

  // Link a staff member's read-only Blink key. Body: { apiKey, consent: true }
  app.post("/staff-wallets/:staffId", ADMIN_ONLY, ready, goodId, async (req, res) => {
    try {
      const { apiKey, consent } = req.body || {};
      const staffId = req.params.staffId;
      if (consent !== true) return res.status(400).json({ error: "Please confirm the staff member agreed to share their balance." });
      const key = typeof apiKey === "string" ? apiKey.trim() : "";
      if (!/^blink_[A-Za-z0-9_-]{10,200}$/.test(key)) return res.status(400).json({ error: "That doesn't look like a Blink API key (it starts with blink_)." });

      const staff = await supabase("GET", "staff", null, `?id=eq.${staffId}&select=id,name`);
      if (!staff.length) return res.status(404).json({ error: "Unknown staff member" });

      // 1. Must be read-only. We refuse to hold a key that could receive or spend.
      const scopes = (((await blink(fetch, key, Q_SCOPES)).authorization || {}).scopes || []).map((s) => String(s).toUpperCase());
      if (!scopes.length) return res.status(400).json({ error: "Blink did not say what this key can do. Make a new key with only Read ticked." });
      const extra = scopes.filter((s) => s !== "READ");
      if (extra.length) return res.status(400).json({ error: `This key can also ${extra.join(" + ").toLowerCase()}. For safety, ask them to delete it in Blink and make a new key with ONLY "Read" ticked.` });

      // 2. Must actually return a balance.
      const bal = summarise(await blink(fetch, key, Q_WALLETS));

      const row = { key_enc: encrypt(key), key_hint: "…" + key.slice(-4), scopes: scopes.join(","), consent_by: "admin", added_at: new Date().toISOString() };
      const existing = await supabase("GET", "staff_wallet_keys", null, `?staff_id=eq.${staffId}&select=staff_id`);
      if (existing.length) await supabase("PATCH", "staff_wallet_keys", row, `?staff_id=eq.${staffId}`);
      else await supabase("POST", "staff_wallet_keys", { staff_id: staffId, ...row });

      const result = { staffId, ok: true, ...bal, checkedAt: new Date().toISOString() };
      cache.set(staffId, { at: Date.now(), result });
      console.log(`Staff wallet linked for ${staff[0].name} (read-only key ${row.key_hint})`);
      res.json(result);
    } catch (e) { res.status(400).json({ error: e.message || "Could not link wallet" }); }
  });

  // Unlink: the stored key is deleted. (They should also delete the key in Blink.)
  app.delete("/staff-wallets/:staffId", ADMIN_ONLY, ready, goodId, async (req, res) => {
    try {
      await supabase("DELETE", "staff_wallet_keys", null, `?staff_id=eq.${req.params.staffId}`);
      cache.delete(req.params.staffId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Could not unlink" }); }
  });
};

module.exports._test = { encrypt, decrypt, summarise };
