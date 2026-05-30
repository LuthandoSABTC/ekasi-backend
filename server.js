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

async function supabase(method, table, body=null, params='') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${params}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : null });
  const text = await res.text();
  console.log(`Supabase ${method} ${table}:`, res.status, text.slice(0,200));
  if (!res.ok) throw new Error(text);
  return text ? JSON.parse(text) : [];
}

app.get("/", (req, res) => res.json({ status: "Bitcoin Ekasi Backend Running ⚡" }));

// ── Supabase proxy endpoints ──
app.get("/db/:table", async (req, res) => {
  try {
    const params = req.url.replace(`/db/${req.params.table}`, '') || '';
    const data = await supabase('GET', req.params.table, null, params);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/db/:table", async (req, res) => {
  try {
    const data = await supabase('POST', req.params.table, req.body);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch("/db/:table", async (req, res) => {
  try {
    const params = req.url.replace(`/db/${req.params.table}`, '') || '';
    const data = await supabase('PATCH', req.params.table, req.body, params);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete("/db/:table", async (req, res) => {
  try {
    const params = req.url.replace(`/db/${req.params.table}`, '') || '';
    await supabase('DELETE', req.params.table, null, params);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Blink test ──
app.post("/test", async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: "Missing API key" });
  try {
    const r = await fetch(BLINK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({ query: "{ me { defaultAccount { wallets { id walletCurrency balance } } } }" })
    });
    const data = await r.json();
    if (data.errors?.length) return res.status(400).json({ error: data.errors[0].message });
    const wallets = data?.data?.me?.defaultAccount?.wallets || [];
    const btc = wallets.find(w => w.walletCurrency === "BTC");
    if (!btc) return res.status(400).json({ error: "No BTC wallet found" });
    res.json({ success: true, balance: btc.balance, walletId: btc.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Blink pay ──
app.post("/pay", async (req, res) => {
  const { apiKey, destination, amount } = req.body;
  if (!apiKey || !destination || !amount) return res.status(400).json({ error: "Missing fields" });
  try {
    const meRes = await fetch(BLINK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({ query: "{ me { defaultAccount { wallets { id walletCurrency } } } }" })
    });
    const meData = await meRes.json();
    if (meData.errors?.length) return res.status(400).json({ error: meData.errors[0].message });
    const wallets = meData?.data?.me?.defaultAccount?.wallets || [];
    const btcWallet = wallets.find(w => w.walletCurrency === "BTC");
    if (!btcWallet) return res.status(400).json({ error: "No BTC wallet found" });

    const isLnurl = destination.toLowerCase().startsWith("lnurl");
    const isLnAddress = destination.includes("@");

    if (isLnAddress) {
      const sendRes = await fetch(BLINK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
        body: JSON.stringify({
          query: `mutation LnAddressPaymentSend($input: LnAddressPaymentSendInput!) {
            lnAddressPaymentSend(input: $input) { status errors { message code } }
          }`,
          variables: { input: { walletId: btcWallet.id, lnAddress: destination, amount: parseInt(amount) } }
        })
      });
      const sendText = await sendRes.text();
      console.log("Blink pay response:", sendText);
      const sendData = JSON.parse(sendText);
      if (sendData.errors?.length) return res.status(400).json({ error: sendData.errors[0].message });
      const result = sendData?.data?.lnAddressPaymentSend;
      if (result?.errors?.length) return res.status(400).json({ error: result.errors[0].message });
      if (["SUCCESS","ALREADY_PAID","PENDING"].includes(result?.status)) return res.json({ success: true, status: result.status });
      return res.status(400).json({ error: "Payment status: " + result?.status });
    } else if (isLnurl) {
      // Decode LNURL
      const chars = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
      const str = destination.toLowerCase().replace("lightning:", "");
      const sep = str.lastIndexOf("1");
      const dataStr = str.slice(sep + 1);
      const data = [];
      for (const c of dataStr) { const val = chars.indexOf(c); if (val !== -1) data.push(val); }
      const bytes = [];
      let acc = 0, bits = 0;
      for (const val of data.slice(0, -6)) {
        acc = (acc << 5) | val; bits += 5;
        while (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
      }
      const callbackUrl = Buffer.from(bytes).toString("utf8");
      console.log("LNURL decoded to:", callbackUrl);
      const lnurlRes = await fetch(callbackUrl);
      const lnurlData = await lnurlRes.json();
      if (lnurlData.status === "ERROR") return res.status(400).json({ error: lnurlData.reason });
      const amountMsat = parseInt(amount) * 1000;
      const invoiceUrl = `${lnurlData.callback}${lnurlData.callback.includes("?")?"&":"?"}amount=${amountMsat}`;
      const invoiceRes = await fetch(invoiceUrl);
      const invoiceData = await invoiceRes.json();
      if (!invoiceData.pr) return res.status(400).json({ error: "No invoice received" });
      const payRes = await fetch(BLINK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
        body: JSON.stringify({
          query: `mutation LnInvoicePaymentSend($input: LnInvoicePaymentInput!) {
            lnInvoicePaymentSend(input: $input) { status errors { message code } }
          }`,
          variables: { input: { walletId: btcWallet.id, paymentRequest: invoiceData.pr } }
        })
      });
      const payData = await payRes.json();
      const payResult = payData?.data?.lnInvoicePaymentSend;
      if (payResult?.errors?.length) return res.status(400).json({ error: payResult.errors[0].message });
      if (["SUCCESS","ALREADY_PAID","PENDING"].includes(payResult?.status)) return res.json({ success: true });
      return res.status(400).json({ error: "Payment failed: " + payResult?.status });
    }
    return res.status(400).json({ error: "Unknown destination format" });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Ekasi backend running on port ${PORT}`));
