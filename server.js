const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const BLINK_URL = "https://api.blink.sv/graphql";

app.get("/", (req, res) => res.json({ status: "Bitcoin Ekasi Backend Running ⚡" }));

// Test connection + get wallet info
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Pay via Lightning address using lnAddressPaymentSend
app.post("/pay", async (req, res) => {
  const { apiKey, destination, amount, memo } = req.body;
  if (!apiKey || !destination || !amount) return res.status(400).json({ error: "Missing fields" });

  try {
    // Step 1 - get wallet ID
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

    console.log("Sending", amount, "sats to", destination, "from wallet", btcWallet.id);

    // Step 2 - send payment
    const sendRes = await fetch(BLINK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({
        query: `mutation LnAddressPaymentSend($input: LnAddressPaymentSendInput!) {
          lnAddressPaymentSend(input: $input) {
            status
            errors { message code }
          }
        }`,
        variables: {
          input: {
            walletId: btcWallet.id,
            lnAddress: destination,
            amount: parseInt(amount)
          }
        }
      })
    });

    const sendText = await sendRes.text();
    console.log("Blink raw response:", sendText);

    let sendData;
    try { sendData = JSON.parse(sendText); } catch { return res.status(500).json({ error: "Bad response: " + sendText }); }

    if (sendData.errors?.length) return res.status(400).json({ error: sendData.errors[0].message, code: sendData.errors[0].extensions?.code });

    const result = sendData?.data?.lnAddressPaymentSend;
    if (!result) return res.status(500).json({ error: "No result from Blink", raw: sendText });

    console.log("Payment result:", result.status, result.errors);

    if (result.errors?.length) return res.status(400).json({ error: result.errors[0].message, code: result.errors[0].code });

    if (["SUCCESS", "ALREADY_PAID", "PENDING"].includes(result.status)) {
      return res.json({ success: true, status: result.status });
    }

    return res.status(400).json({ error: "Payment failed with status: " + result.status, raw: JSON.stringify(result) });

  } catch (e) {
    console.error("Pay error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Ekasi backend running on port ${PORT}`));
