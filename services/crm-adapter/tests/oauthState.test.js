const {
  OAUTH_STATE_MAX_AGE_MS,
  resolveOAuthStateSecret,
  signOAuthState,
  verifyOAuthState,
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
    const crypto = require("crypto");
    const old = Date.now() - OAUTH_STATE_MAX_AGE_MS - 1000;
    const payload = `${crypto.randomBytes(12).toString("hex")}.${old}`;
    const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
    expect(verifyOAuthState(`${payload}.${sig}`, SECRET)).toBe(false);
  });

  it("resolves a stable secret from the environment", () => {
    expect(resolveOAuthStateSecret({ clientSecret: "from-options" })).toBeTruthy();
  });
});
