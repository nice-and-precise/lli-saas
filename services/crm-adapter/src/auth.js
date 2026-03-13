const crypto = require("crypto");

const DEFAULT_ISSUER = "lli-saas-pilot";
const DEFAULT_AUDIENCE = "lli-saas";
const DEFAULT_OPERATOR_ROLE = "operator";
const DEFAULT_SERVICE_ROLE = "service";
const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60;
const DEFAULT_OAUTH_STATE_TTL_SECONDS = 10 * 60;

function base64UrlEncode(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return buffer.toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function parseJson(encoded, label) {
  try {
    return JSON.parse(base64UrlDecode(encoded));
  } catch {
    throw new Error(`invalid_${label}`);
  }
}

function createSignature(input, secret) {
  return crypto.createHmac("sha256", secret).update(input).digest("base64url");
}

function getAuthConfig(overrides = {}) {
  return {
    jwtSecret: overrides.jwtSecret ?? process.env.AUTH_JWT_SECRET ?? "",
    issuer: overrides.issuer ?? process.env.AUTH_JWT_ISSUER ?? DEFAULT_ISSUER,
    audience: overrides.audience ?? process.env.AUTH_JWT_AUDIENCE ?? DEFAULT_AUDIENCE,
    tokenTtlSeconds: Number(
      overrides.tokenTtlSeconds ?? process.env.AUTH_JWT_TTL_SECONDS ?? DEFAULT_TOKEN_TTL_SECONDS,
    ),
    oauthStateTtlSeconds: Number(
      overrides.oauthStateTtlSeconds ??
        process.env.AUTH_OAUTH_STATE_TTL_SECONDS ??
        DEFAULT_OAUTH_STATE_TTL_SECONDS,
    ),
    operatorEmail: overrides.operatorEmail ?? process.env.OPERATOR_EMAIL ?? "",
    operatorPassword: overrides.operatorPassword ?? process.env.OPERATOR_PASSWORD ?? "",
    operatorTenantId: overrides.operatorTenantId ?? process.env.OPERATOR_TENANT_ID ?? "pilot",
    operatorRole: overrides.operatorRole ?? process.env.OPERATOR_ROLE ?? DEFAULT_OPERATOR_ROLE,
    portalBaseUrl: (overrides.portalBaseUrl ?? process.env.OPERATOR_PORTAL_BASE_URL ?? "").replace(
      /\/+$/,
      "",
    ),
  };
}

function assertAuthConfigured(config) {
  if (!config.jwtSecret) {
    throw new Error("AUTH_JWT_SECRET is required");
  }
}

function normalizeAllowedOrigins(value = process.env.AUTH_ALLOWED_ORIGINS ?? "") {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function signJwt(claims, config) {
  assertAuthConfigured(config);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: config.issuer,
    aud: config.audience,
    exp: now + config.tokenTtlSeconds,
    ...claims,
  };
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createSignature(`${encodedHeader}.${encodedPayload}`, config.jwtSecret);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function signOAuthState(claims, config) {
  return signJwt(
    {
      ...claims,
      aud: "monday-oauth",
      role: claims.role ?? DEFAULT_OPERATOR_ROLE,
      exp: Math.floor(Date.now() / 1000) + config.oauthStateTtlSeconds,
    },
    {
      ...config,
      audience: "monday-oauth",
      tokenTtlSeconds: config.oauthStateTtlSeconds,
    },
  );
}

function verifyJwt(token, config, options = {}) {
  assertAuthConfigured(config);

  if (!token || typeof token !== "string") {
    throw new Error("missing_token");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("invalid_token");
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = createSignature(`${encodedHeader}.${encodedPayload}`, config.jwtSecret);
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    throw new Error("invalid_signature");
  }

  const header = parseJson(encodedHeader, "header");
  if (header.alg !== "HS256") {
    throw new Error("unsupported_alg");
  }

  const payload = parseJson(encodedPayload, "payload");
  const now = Math.floor(Date.now() / 1000);
  const expectedAudience = options.audience ?? config.audience;
  const audienceValues = Array.isArray(payload.aud) ? payload.aud : [payload.aud];

  if (
    !payload.sub ||
    !payload.role ||
    !payload.tenant_id ||
    !payload.iss ||
    !payload.aud ||
    !payload.exp
  ) {
    throw new Error("missing_required_claims");
  }
  if (payload.iss !== config.issuer) {
    throw new Error("invalid_issuer");
  }
  if (!audienceValues.includes(expectedAudience)) {
    throw new Error("invalid_audience");
  }
  if (!Number.isInteger(payload.exp) || payload.exp <= now) {
    throw new Error("token_expired");
  }

  return payload;
}

function getBearerToken(req) {
  const header = req.headers.authorization;
  if (!header || typeof header !== "string") {
    return null;
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

function requireOperatorCredentials(config, email, password) {
  if (!config.operatorEmail || !config.operatorPassword) {
    return { ok: false, reason: "operator_credentials_not_configured" };
  }

  const valid =
    String(email ?? "")
      .trim()
      .toLowerCase() === config.operatorEmail.trim().toLowerCase() &&
    String(password ?? "") === config.operatorPassword;

  if (!valid) {
    return { ok: false, reason: "invalid_credentials" };
  }

  return { ok: true };
}

module.exports = {
  DEFAULT_OPERATOR_ROLE,
  DEFAULT_SERVICE_ROLE,
  getAuthConfig,
  getBearerToken,
  normalizeAllowedOrigins,
  requireOperatorCredentials,
  signJwt,
  signOAuthState,
  verifyJwt,
};
