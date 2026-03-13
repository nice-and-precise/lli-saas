const SESSION_STORAGE_KEY = "lli.operator.access_token";
const TOKEN_EXPIRY_MARGIN_SECONDS = 60;

function decodeTokenPayload(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload;
  } catch {
    return null;
  }
}

function isTokenExpired(token) {
  const payload = decodeTokenPayload(token);
  if (!payload || typeof payload.exp !== "number") return false;
  return Date.now() / 1000 > payload.exp - TOKEN_EXPIRY_MARGIN_SECONDS;
}

function getAccessToken(storage = globalThis.localStorage) {
  const token = storage?.getItem(SESSION_STORAGE_KEY) ?? "";
  if (token && isTokenExpired(token)) {
    storage?.removeItem(SESSION_STORAGE_KEY);
    return "";
  }
  return token;
}

function setAccessToken(token, storage = globalThis.localStorage) {
  storage?.setItem(SESSION_STORAGE_KEY, token);
}

function clearAccessToken(storage = globalThis.localStorage) {
  storage?.removeItem(SESSION_STORAGE_KEY);
}

function isAuthenticated(storage = globalThis.localStorage) {
  return Boolean(getAccessToken(storage));
}

export { SESSION_STORAGE_KEY, clearAccessToken, getAccessToken, isAuthenticated, isTokenExpired, setAccessToken };
