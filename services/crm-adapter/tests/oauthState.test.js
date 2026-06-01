const {
  OAUTH_STATE_MAX_AGE_MS,
  resolveOAuthStateSecret,
  signOAuthState,
  verifyOAuthState,
  oauthStateNonce,
  oauthStateBindingMatches,
  readCookie,
} = require("../src/oauthState");

const SECRET = "test-oauth-secret";

describe("oauthState", () => {
  it("round-trips a freshly signed state", () => {
    expect(verifyOAuthState(signOAuthState(SECRET), SECRET)).toBe(true);
  });

  it("rejects a state signed with a different secret", () => {
    expect(verifyOAuthState(signOAuthState("other-secret"), SECRET)).toBe(false);
  });

  it("rejects missing, malformed, or tampered states", () => {
    expect(verifyOAuthState(undefined, SECRET)).toBe(false);
    expect(verifyOAuthState("", SECRET)).toBe(false);
    expect(verifyOAuthState("only.two", SECRET)).toBe(false);
    const [nonce, ts, sig] = signOAuthState(SECRET).split(".");
    expect(verifyOAuthState(`${nonce}.${ts}.${sig}deadbeef`, SECRET)).toBe(false); // length mismatch
    expect(verifyOAuthState(`tampered.${ts}.${sig}`, SECRET)).toBe(false); // sig mismatch
  });

  it("rejects an expired state (older than the max age)", () => {
    // Sign in the past via fake timers so the signature uses the real derived key.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() - OAUTH_STATE_MAX_AGE_MS - 5000));
    const oldState = signOAuthState(SECRET);
    vi.useRealTimers();
    expect(verifyOAuthState(oldState, SECRET)).toBe(false);
  });

  it("tolerates small clock skew (a slightly future-dated state still verifies)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 30 * 1000)); // 30s ahead, within tolerance
    const skewedState = signOAuthState(SECRET);
    vi.useRealTimers();
    expect(verifyOAuthState(skewedState, SECRET)).toBe(true);
  });

  it("binds state to a cookie nonce (constant-time match)", () => {
    const state = signOAuthState(SECRET);
    const nonce = oauthStateNonce(state);
    expect(oauthStateBindingMatches(state, nonce)).toBe(true);
    expect(oauthStateBindingMatches(state, "different-nonce")).toBe(false);
    expect(oauthStateBindingMatches(state, "")).toBe(false);
    expect(oauthStateBindingMatches(state, undefined)).toBe(false);
    expect(oauthStateBindingMatches(undefined, nonce)).toBe(false);
  });

  it("reads a named cookie from a Cookie header", () => {
    expect(readCookie("a=1; lli_oauth_nonce=abc123; b=2", "lli_oauth_nonce")).toBe("abc123");
    expect(readCookie("a=1; b=2", "lli_oauth_nonce")).toBeNull();
    expect(readCookie(undefined, "lli_oauth_nonce")).toBeNull();
  });

  it("resolves a stable secret from the environment", () => {
    expect(resolveOAuthStateSecret({ clientSecret: "from-options" })).toBeTruthy();
  });

  it("fails closed in production when no real secret is available (no public-constant fallback)", () => {
    const savedNodeEnv = process.env.NODE_ENV;
    const savedShared = process.env.SERVICE_SHARED_SECRET;
    const savedMonday = process.env.MONDAY_CLIENT_SECRET;
    try {
      delete process.env.SERVICE_SHARED_SECRET;
      delete process.env.MONDAY_CLIENT_SECRET;
      process.env.NODE_ENV = "production";
      expect(() => resolveOAuthStateSecret()).toThrow(/secret unavailable/i);

      process.env.NODE_ENV = "test";
      expect(resolveOAuthStateSecret()).toBe("lli-dev-oauth-state-secret");
    } finally {
      process.env.NODE_ENV = savedNodeEnv;
      if (savedShared === undefined) delete process.env.SERVICE_SHARED_SECRET;
      else process.env.SERVICE_SHARED_SECRET = savedShared;
      if (savedMonday === undefined) delete process.env.MONDAY_CLIENT_SECRET;
      else process.env.MONDAY_CLIENT_SECRET = savedMonday;
    }
  });
});
