const crypto = require("crypto");

// CSRF protection for the Monday OAuth handshake via a STATELESS, signed `state`
// (no cookie — robust on serverless, immune to the single-cookie races that a
// nonce-in-cookie suffers across repeat/concurrent logins and cross-domain
// redirects). state = `nonce.timestamp.HMAC(nonce.timestamp)`; the callback
// re-derives the HMAC and checks freshness.
//
// Verified live 2026-06-01: Monday echoes `state` back byte-for-byte on the
// callback (query keys: code/region/scope/state), so a forged `/auth/callback`
// without a state we signed is rejected with 400 invalid_oauth_state.
const OAUTH_STATE_MAX_AGE_MS = 15 * 60 * 1000; // 15 min — covers a fresh IdP login

function resolveOAuthStateSecret(options = {}) {
  // Any stable server secret works; these are present in prod. The constant
  // fallback only keeps local dev (no secrets) self-consistent — sign and verify
  // still use the same value, so the round-trip holds.
  return (
    process.env.SERVICE_SHARED_SECRET ||
    process.env.MONDAY_CLIENT_SECRET ||
    options.clientSecret ||
    "lli-dev-oauth-state-secret"
  );
}

function signOAuthState(secret) {
  const payload = `${crypto.randomBytes(12).toString("hex")}.${Date.now()}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifyOAuthState(state, secret, maxAgeMs = OAUTH_STATE_MAX_AGE_MS) {
  if (typeof state !== "string") return false;
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [nonce, ts, sig] = parts;
  const expected = crypto.createHmac("sha256", secret).update(`${nonce}.${ts}`).digest("hex");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }
  const age = Date.now() - Number(ts);
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
}

module.exports = {
  OAUTH_STATE_MAX_AGE_MS,
  resolveOAuthStateSecret,
  signOAuthState,
  verifyOAuthState,
};
