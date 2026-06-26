const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const BLINK_URL = "https://api.blink.sv/graphql";

// ── Supabase config ──
const SUPABASE_URL = "https://bnteowvyioptlvohyert.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJudGVvd3Z5aW9wdGx2b2h5ZXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNTg2NTUsImV4cCI6MjA5NTYzNDY1NX0._-PZgmwe7CGi9aDeoOh_LsauaRru6LGgxxVZj9pv0MY";

async function supabase(method, table, body = null, params = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${params}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : null });
  const text = await res.text();
  console.log(`Supabase ${method} ${table}:`, res.status, text.slice(0, 200));
  if (!res.ok) throw new Error(text);
  return text ? JSON.parse(text) : [];
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

// ── Supabase proxy endpoints ──
app.get("/db/:table", async (req, res) => {
  try {
    const params = req.url.replace(`/db/${req.params.table}`, '') || '';
    const data = await supabase('GET', req.params.table, null, params);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/db/:table", async (req, res) => {
  try {
    const data = await supabase('POST', req.params.table, req.body);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch("/db/:table", async (req, res) => {
  try {
    const params = req.url.replace(`/db/${req.params.table}`, '') || '';
    const data = await supabase('PATCH', req.params.table, req.body, params);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/db/:table", async (req, res) => {
  try {
    const params = req.url.replace(`/db/${req.params.table}`, '') || '';
    await supabase('DELETE', req.params.table, null, params);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Blink test ──
app.post("/test", async (req, res) => {
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

// ── Blink pay ──
app.post("/pay", async (req, res) => {
  const { apiKey, destination, amount, memo } = req.body;
  if (!apiKey || !destination || !amount) {
    return res.status(400).json({ error: "Missing fields" });
  }

  // Default memo if none provided
  const paymentMemo = memo || "Bitcoin Ekasi ⚡ Mossel Bay";

  console.log(`Pay request: destination=${destination.slice(0,30)}... amount=${amount} memo="${paymentMemo}"`);

  try {
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
              amount: parseInt(amount),
              memo: paymentMemo
            }
          }
        })
      });
      if (data.errors?.length) return res.status(400).json({ error: data.errors[0].message });
      const result = data?.data?.lnAddressPaymentSend;
      if (result?.errors?.length) return res.status(400).json({ error: result.errors[0].message });
      if (["SUCCESS", "ALREADY_PAID", "PENDING"].includes(result?.status)) {
        return res.json({ success: true, status: result.status });
      }
      return res.status(400).json({ error: "Payment status: " + result?.status });
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
        return res.json({ success: true, status: payResult.status });
      }
      return res.status(400).json({ error: "Payment failed: " + payResult?.status });
    }

    return res.status(400).json({ error: "Unknown destination format. Use Lightning Address (name@domain) or LNURL." });

  } catch (e) {
    console.error("Pay error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Ekasi backend running on port ${PORT}`));
