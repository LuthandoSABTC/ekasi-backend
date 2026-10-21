// auth.js — logins for the Attendance Tracker.
// Passwords are stored only as salted scrypt hashes; a login returns a signed,
// expiring token that the pages send with every request. No external packages.
const crypto = require("crypto");

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) {
  console.warn("SESSION_SECRET is not set — using a random one; everyone is logged out whenever the server restarts.");
}
const TOKEN_HOURS = parseInt(process.env.SESSION_HOURS || "24", 10);
const SCRYPT = { N: 16384, r: 8, p: 1 };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(String(pw), salt, 32, SCRYPT).toString("hex");
  return `scrypt$${salt}$${h}`;
}

function verifyPassword(pw, stored) {
  if (!stored || typeof stored !== "string" || !stored.startsWith("scrypt$")) return false;
  const [, salt, h] = stored.split("$");
  if (!salt || !h) return false;
  const want = Buffer.from(h, "hex");
  const got = crypto.scryptSync(String(pw), salt, want.length, SCRYPT);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

const b64 = (b) => Buffer.from(b).toString("base64url");
function sign(body) { return crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url"); }

function makeToken(payload) {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + TOKEN_HOURS * 3600 }));
  return `${body}.${sign(body)}`;
}

function readToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const good = sign(body);
  if (!sig || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p.exp || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch (e) { return null; }
}

// Express middleware: require a valid token, optionally of certain roles.
function requireAuth(...roles) {
  return (req, res, next) => {
    const h = req.headers.authorization || "";
    const p = readToken(h.startsWith("Bearer ") ? h.slice(7) : "");
    if (!p) return res.status(401).json({ error: "Please log in" });
    if (roles.length && !roles.includes(p.role)) return res.status(403).json({ error: "Not allowed for your account" });
    req.user = p;
    next();
  };
}

// Brute-force guard: max attempts per key (ip + who) in a window.
const attempts = new Map();
function tooManyAttempts(key, max = 8, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.first > windowMs) { attempts.set(key, { count: 1, first: now }); return false; }
  a.count++;
  return a.count > max;
}
function clearAttempts(key) { attempts.delete(key); }
setInterval(() => { const now = Date.now(); for (const [k, a] of attempts) if (now - a.first > 15 * 60 * 1000) attempts.delete(k); }, 10 * 60 * 1000).unref();

module.exports = { hashPassword, verifyPassword, makeToken, readToken, requireAuth, tooManyAttempts, clearAttempts, TOKEN_HOURS };
