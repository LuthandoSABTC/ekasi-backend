const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const BLINK_URL = "https://api.blink.sv/graphql";

app.get("/", (req, res) => res.json({ status: "Bitcoin Ekasi Backend Running ⚡" }));

// Test Blink connection
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
    console.log("Blink test:", JSON.stringify(data));
    if (data.errors?.length) return res.status(400).json({ error: data.errors[0].message });
    const wallets = data?.data?.me?.defaultAccount?.wallets || [];
    const btc = wallets.find(w => w.walletCurrency === "BTC");
    if (!btc) return res.status(400).json({ error: "No BTC wallet found" });
    res.json({ success: true, balance: btc.balance, walletId: btc.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Send sats via Blink to Lightning address
app.post("/pay", async (req, res) => {
  const { apiKey, destination, amount, memo } = req.body;
  if (!apiKey || !destination || !amount) return res.status(400).json({ error: "Missing fields" });

  try {
    // Step 1 — get BTC wallet ID
    const meRes = await fetch(BLINK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({ query: "{ me { defaultAccount { wallets { id walletCurrency } } } }" })
    });
    const meData = await meRes.json();
    console.log("Blink wallet:", JSON.stringify(meData));
    if (meData.errors?.length) return res.status(400).json({ error: meData.errors[0].message });
    const wallets = meData?.data?.me?.defaultAccount?.wallets || [];
    const btcWallet = wallets.find(w => w.walletCurrency === "BTC");
    if (!btcWallet) return res.status(400).json({ error: "No BTC wallet found" });

    // Step 2 — send to Lightning address
    const sendRes = await fetch(BLINK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({
        query: `mutation LnAddressPaymentSend($input: LnAddressPaymentSendInput!) {
          lnAddressPaymentSend(input: $input) {
            status
            errors { message }
          }
        }`,
        variables: {
          input: {
            walletId: btcWallet.id,
            lnAddress: destination,
            amount: amount,
            memo: memo || "Bitcoin Ekasi Diploma Reward"
          }
        }
      })
    });
    const sendData = await sendRes.json();
    console.log("Blink pay:", JSON.stringify(sendData));

    if (sendData.errors?.length) return res.status(400).json({ error: sendData.errors[0].message });
    const result = sendData?.data?.lnAddressPaymentSend;
    if (!result) return res.status(500).json({ error: "No response from Blink" });
    if (result.errors?.length) return res.status(400).json({ error: result.errors[0].message });

    // Treat SUCCESS, ALREADY_PAID, PENDING all as success
    if (["SUCCESS", "ALREADY_PAID", "PENDING"].includes(result.status)) {
      return res.json({ success: true, status: result.status });
    }
    return res.status(400).json({ error: "Payment status: " + result.status });

  } catch (e) {
    console.error("Pay error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Ekasi backend running on port ${PORT}`));
