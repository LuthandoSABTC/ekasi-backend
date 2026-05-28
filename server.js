const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => res.json({ status: "Bitcoin Ekasi Backend Running ⚡" }));

// Test BTCPay connection — use Lightning info endpoint directly
app.post("/test", async (req, res) => {
  const { btcpayUrl, apiKey, storeId } = req.body;
  if (!btcpayUrl || !apiKey || !storeId) return res.status(400).json({ error: "Missing fields" });
  try {
    const r = await fetch(`${btcpayUrl}/api/v1/stores/${storeId}/lightning/BTC/info`, {
      headers: { "Authorization": `token ${apiKey}`, "Content-Type": "application/json" }
    });
    const text = await r.text();
    console.log("BTCPay test:", r.status, text);
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) return res.status(r.status).json({ error: data.message || data.detail || text });
    res.json({ success: true, nodeId: data.nodeURIs?.[0] || "Lightning node connected ⚡" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Pay via Lightning
app.post("/pay", async (req, res) => {
  const { btcpayUrl, apiKey, storeId, destination, amount, memo } = req.body;
  if (!btcpayUrl || !apiKey || !storeId || !destination || !amount) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  try {
    console.log(`Paying ${amount} sats to ${destination}`);
    const r = await fetch(`${btcpayUrl}/api/v1/stores/${storeId}/lightning/BTC/pay`, {
      method: "POST",
      headers: { "Authorization": `token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        destination,
        amount: String(amount * 1000),
        description: memo || "Bitcoin Ekasi Diploma Reward"
      })
    });
    const text = await r.text();
    console.log("BTCPay pay:", r.status, text);
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) return res.status(r.status).json({ error: data.message || data.detail || text });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Ekasi backend running on port ${PORT}`));
