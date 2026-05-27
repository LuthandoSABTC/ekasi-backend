const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
 
const app = express();
app.use(cors());
app.use(express.json());
 
const BLINK_URL = "https://api.blink.sv/graphql";
 
app.get("/", (req, res) => res.json({ status: "Bitcoin Ekasi Backend Running ⚡" }));
 
app.post("/blink", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) return res.status(401).json({ error: "Missing API key" });
 
  try {
    const response = await fetch(BLINK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify(req.body),
    });
 
    const text = await response.text();
    console.log("Blink raw response:", text);
 
    let data;
    try { data = JSON.parse(text); }
    catch { return res.status(500).json({ error: "Invalid JSON from Blink", raw: text }); }
 
    // Normalize payment status — treat SUCCESS/ALREADY_PAID/PENDING all as success
    const payResult = data?.data?.lnAddressPaymentSend;
    if (payResult) {
      console.log("Payment status from Blink:", payResult.status, payResult.errors);
      if (["SUCCESS", "ALREADY_PAID", "PENDING"].includes(payResult.status)) {
        return res.json({ data: { lnAddressPaymentSend: { status: "SUCCESS", errors: [] } } });
      }
    }
 
    res.json(data);
  } catch (err) {
    console.error("Backend error:", err.message);
    res.status(500).json({ error: err.message });
  }
});
 
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Ekasi backend running on port ${PORT}`));
