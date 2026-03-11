const express = require("express");
const { getInternalLeadSchemaPath } = require("./internalLead");
const { MondayClient } = require("./mondayClient");
const { MemoryTokenStore } = require("./tokenStore");

function createApp(options = {}) {
  const app = express();
  const tokenStore = options.tokenStore ?? new MemoryTokenStore();
  const mondayClient =
    options.mondayClient ??
    new MondayClient({
      clientId: options.clientId ?? process.env.MONDAY_CLIENT_ID,
      clientSecret: options.clientSecret ?? process.env.MONDAY_CLIENT_SECRET,
      redirectUri: options.redirectUri ?? process.env.MONDAY_REDIRECT_URI,
      apiBaseUrl: options.apiBaseUrl ?? process.env.MONDAY_API_BASE_URL,
    });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "crm-adapter" });
  });

  app.get("/contract", (_req, res) => {
    res.json({ contract_path: getInternalLeadSchemaPath() });
  });

  app.get("/auth/login", (req, res) => {
    const state = req.query.state || "lli-saas-state";
    const location = mondayClient.getAuthorizationUrl(state);
    res.redirect(location);
  });

  app.get("/auth/callback", async (req, res) => {
    const { code } = req.query;

    if (!code) {
      return res.status(400).json({ error: "Missing OAuth code" });
    }

    const tokenPayload = await mondayClient.exchangeCodeForToken(code);
    await tokenStore.save("monday_access_token", tokenPayload.access_token);
    if (typeof tokenStore.saveState === "function") {
      await tokenStore.saveState({
        tokens: {
          monday_access_token: tokenPayload.access_token,
        },
        account_id: tokenPayload.account_id ?? null,
      });
    }

    return res.json({
      connected: true,
      account_id: tokenPayload.account_id ?? null,
    });
  });

  return app;
}

module.exports = {
  createApp,
};
