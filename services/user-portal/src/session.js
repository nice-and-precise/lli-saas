const SESSION_STORAGE_KEY = "lli.operator.access_token";

function getAccessToken(storage = globalThis.localStorage) {
  return storage?.getItem(SESSION_STORAGE_KEY) ?? "";
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

export { SESSION_STORAGE_KEY, clearAccessToken, getAccessToken, isAuthenticated, setAccessToken };
