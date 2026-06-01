const crypto = require("crypto");

// CSRF protection for the Monday OAuth handshake. Two layers:
//
//   1. A signed, freshness-bounded `state` (`nonce.timestamp.HMAC`) echoed to
//      Monday and re-verified on the callback. Monday echoes `state` back
//      byte-for-byte (verified live 2026-06-01: query keys code/region/scope/
//      state), so a forged callback without a state we signed is rejected.
//   2. SESSION BINDING: the state's `nonce` is also set in an HttpOnly cookie at
//      /auth/login and must match on the callback. Without this, the signed
//      state alone only proves "the server minted this recently" — an attacker
//      can mint one from the open /auth/login and run a login-CSRF (phish the
//      operator's browser into completing the attacker's OAuth code, overwriting
//      the stored token). The cookie ties the handshake to the initiating
//      browser, which an attacker-minted state cannot satisfy.
//
// The HMAC key is DERIVED from the resolved secret (not used raw), so the
// service-to-service bearer (SERVICE_SHARED_SECRET) leaking does not directly
// hand an attacker the state-signing key.
const OAUTH_STATE_MAX_AGE_MS = 15 * 60 * 1000; // 15 min — covers a fresh IdP login
const OAUTH_STATE_SKEW_MS = 60 * 1000; // tolerate ~1 min of clock skew between serverless instances
const OAUTH_NONCE_COOKIE = "lli_oauth_nonce";

function resolveOAuthStateSecret(options = {}) {
  // Any stable server secret works; these are present in prod.
  const secret =
    process.env.SERVICE_SHARED_SECRET || process.env.MONDAY_CLIENT_SECRET || options.clientSecret;
  if (secret) return secret;

  // No real secret resolved. Falling back to a constant would sign state with a
  // value that's public in the repo — silently voiding CSRF protection. Fail
  // loudly in production rather than degrade; the constant only keeps local dev
  // and tests self-consistent (sign + verify share the same value).
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "OAuth state secret unavailable: set SERVICE_SHARED_SECRET or MONDAY_CLIENT_SECRET",
    );
  }
  return "lli-dev-oauth-state-secret";
}

// Domain-separated subkey so the raw secret (also the S2S bearer) is never the
// HMAC key directly.
function deriveStateKey(secret) {
  return crypto.createHmac("sha256", String(secret)).update("lli-oauth-state-v1").digest();
}

function signOAuthState(secret) {
  const payload = `${crypto.randomBytes(12).toString("hex")}.${Date.now()}`;
  const sig = crypto.createHmac("sha256", deriveStateKey(secret)).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

// The first segment of a state is its nonce — the value bound into the cookie.
function oauthStateNonce(state) {
  return typeof state === "string" ? state.split(".")[0] : null;
}

function verifyOAuthState(state, secret, maxAgeMs = OAUTH_STATE_MAX_AGE_MS) {
  if (typeof state !== "string") return false;
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [nonce, ts, sig] = parts;
  const expected = crypto
    .createHmac("sha256", deriveStateKey(secret))
    .update(`${nonce}.${ts}`)
    .digest("hex");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }
  // `ts` is inside the HMAC, so a future/NaN timestamp can't be forged; the lower
  // bound only guards against clock skew, hence the small tolerance (a tight
  // `age >= 0` would false-reject legit connects across slightly-skewed instances).
  const age = Date.now() - Number(ts);
  return Number.isFinite(age) && age >= -OAUTH_STATE_SKEW_MS && age <= maxAgeMs;
}

// Constant-time check that the callback's state nonce matches the cookie the
// browser carried from /auth/login.
function oauthStateBindingMatches(state, cookieNonce) {
  const stateNonce = oauthStateNonce(state);
  if (typeof stateNonce !== "string" || typeof cookieNonce !== "string" || cookieNonce.length === 0) {
    return false;
  }
  const a = Buffer.from(stateNonce);
  const b = Buffer.from(cookieNonce);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Minimal Cookie-header parser (avoids adding cookie-parser just for one cookie).
function readCookie(cookieHeader, name) {
  if (typeof cookieHeader !== "string") return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

module.exports = {
  OAUTH_STATE_MAX_AGE_MS,
  OAUTH_NONCE_COOKIE,
  resolveOAuthStateSecret,
  signOAuthState,
  verifyOAuthState,
  oauthStateNonce,
  oauthStateBindingMatches,
  readCookie,
};
