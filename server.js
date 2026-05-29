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

// Decode bech32 LNURL to URL
function decodeLnurl(lnurl) {
  const decoded = Buffer.from(
    lnurl.toLowerCase().replace("lightning:", "").replace("lnurl1", ""),
    "base64"
  );
  // Use proper bech32 decode
  const chars = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const data = [];
  const str = lnurl.toLowerCase().replace("lightning:", "");
  // Find separator
  const sep = str.lastIndexOf("1");
  const dataStr = str.slice(sep + 1);
  for (const c of dataStr) {
    const val = chars.indexOf(c);
    if (val === -1) continue;
    data.push(val);
  }
  // Convert 5-bit to 8-bit
  const bytes = [];
  let acc = 0, bits = 0;
  for (const val of data.slice(0, -6)) {
    acc = (acc << 5) | val;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

// Pay via Lightning address OR LNURL (for Bolt NFC cards)
app.post("/pay", async (req, res) => {
  const { apiKey, destination, amount, memo } = req.body;
  if (!apiKey || !destination || !amount) return res.status(400).json({ error: "Missing fields" });

  try {
    // Get BTC wallet ID
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

    const sats = parseInt(amount);
    const dest = destination.trim();
    const isLnurl = dest.toLowerCase().startsWith("lnurl") || dest.toLowerCase().startsWith("lightning:lnurl");
    const isLnAddress = dest.includes("@");

    console.log(`Paying ${sats} sats to ${dest} (${isLnurl ? "LNURL" : isLnAddress ? "LN Address" : "unknown"})`);

    if (isLnAddress) {
      // Pay via Lightning address
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
          variables: { input: { walletId: btcWallet.id, lnAddress: dest, amount: sats } }
        })
      });
      const sendText = await sendRes.text();
      console.log("LN Address response:", sendText);
      const sendData = JSON.parse(sendText);
      if (sendData.errors?.length) return res.status(400).json({ error: sendData.errors[0].message });
      const result = sendData?.data?.lnAddressPaymentSend;
      if (result?.errors?.length) return res.status(400).json({ error: result.errors[0].message, code: result.errors[0].code });
      if (["SUCCESS","ALREADY_PAID","PENDING"].includes(result?.status)) return res.json({ success: true, status: result.status });
      return res.status(400).json({ error: "Payment status: " + result?.status });

    } else if (isLnurl) {
      // Step 1: Decode LNURL to callback URL
      let callbackUrl;
      try {
        callbackUrl = decodeLnurl(dest);
        console.log("Decoded LNURL to:", callbackUrl);
      } catch(e) {
        return res.status(400).json({ error: "Could not decode LNURL: " + e.message });
      }

      // Step 2: Fetch LNURL pay params
      const lnurlRes = await fetch(callbackUrl);
      const lnurlData = await lnurlRes.json();
      console.log("LNURL params:", JSON.stringify(lnurlData));

      if (lnurlData.status === "ERROR") return res.status(400).json({ error: lnurlData.reason || "LNURL error" });
      if (!lnurlData.callback) return res.status(400).json({ error: "No callback in LNURL response" });

      const minSendable = lnurlData.minSendable || 1000; // millisats
      const maxSendable = lnurlData.maxSendable || 100000000;
      const amountMsat = sats * 1000;

      if (amountMsat < minSendable) return res.status(400).json({ error: `Amount too low. Min: ${minSendable/1000} sats` });
      if (amountMsat > maxSendable) return res.status(400).json({ error: `Amount too high. Max: ${maxSendable/1000} sats` });

      // Step 3: Get invoice from LNURL callback
      const invoiceUrl = `${lnurlData.callback}${lnurlData.callback.includes("?")?"&":"?"}amount=${amountMsat}`;
      console.log("Fetching invoice from:", invoiceUrl);
      const invoiceRes = await fetch(invoiceUrl);
      const invoiceData = await invoiceRes.json();
      console.log("Invoice response:", JSON.stringify(invoiceData));

      if (invoiceData.status === "ERROR") return res.status(400).json({ error: invoiceData.reason || "Invoice error" });
      if (!invoiceData.pr) return res.status(400).json({ error: "No invoice (pr) in response" });

      // Step 4: Pay the invoice via Blink
      const payRes = await fetch(BLINK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
        body: JSON.stringify({
          query: `mutation LnInvoicePaymentSend($input: LnInvoicePaymentInput!) {
            lnInvoicePaymentSend(input: $input) {
              status
              errors { message code }
            }
          }`,
          variables: { input: { walletId: btcWallet.id, paymentRequest: invoiceData.pr } }
        })
      });
      const payText = await payRes.text();
      console.log("Invoice payment response:", payText);
      const payData = JSON.parse(payText);
      if (payData.errors?.length) return res.status(400).json({ error: payData.errors[0].message });
      const payResult = payData?.data?.lnInvoicePaymentSend;
      if (payResult?.errors?.length) return res.status(400).json({ error: payResult.errors[0].message, code: payResult.errors[0].code });
      if (["SUCCESS","ALREADY_PAID","PENDING"].includes(payResult?.status)) return res.json({ success: true, status: payResult.status });
      return res.status(400).json({ error: "Payment status: " + payResult?.status });

    } else {
      return res.status(400).json({ error: "Unknown destination format. Use Lightning address (name@blink.sv) or LNURL." });
    }

  } catch (e) {
    console.error("Pay error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Ekasi backend running on port ${PORT}`));
