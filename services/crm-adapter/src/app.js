const express = require("express");
const { getInternalLeadSchemaPath, mapInternalLeadToMondayItem } = require("./internalLead");
const { MondayClient } = require("./mondayClient");
const { FileTokenStore } = require("./tokenStore");

async function getPersistedState(tokenStore) {
  if (typeof tokenStore.getState === "function") {
    return tokenStore.getState();
  }

  const token =
    typeof tokenStore.get === "function" ? await tokenStore.get("monday_access_token") : null;

  return {
    tokens: token ? { monday_access_token: token } : {},
    board: null,
    account_id: null,
    updated_at: null,
  };
}

function createApp(options = {}) {
  const app = express();
  const tokenStore = options.tokenStore ?? new FileTokenStore();
  const mondayClient =
    options.mondayClient ??
    new MondayClient({
      clientId: options.clientId ?? process.env.MONDAY_CLIENT_ID,
      clientSecret: options.clientSecret ?? process.env.MONDAY_CLIENT_SECRET,
      redirectUri: options.redirectUri ?? process.env.MONDAY_REDIRECT_URI,
      apiBaseUrl: options.apiBaseUrl ?? process.env.MONDAY_API_BASE_URL,
    });

  app.use(express.json());

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

  app.get("/boards", async (_req, res) => {
    const state = await getPersistedState(tokenStore);
    const token = state.tokens?.monday_access_token ?? null;

    if (!token) {
      return res.status(409).json({ error: "Monday OAuth token not configured" });
    }

    const boards = await mondayClient.listBoards(token);

    return res.json({
      boards,
      selected_board: state.board ?? null,
    });
  });

  app.post("/boards/select", async (req, res) => {
    const { board_id: boardId } = req.body ?? {};

    if (typeof boardId !== "string" || boardId.trim() === "") {
      return res.status(400).json({ error: "board_id is required" });
    }

    const state = await getPersistedState(tokenStore);
    const token = state.tokens?.monday_access_token ?? null;

    if (!token) {
      return res.status(409).json({ error: "Monday OAuth token not configured" });
    }

    const boards = await mondayClient.listBoards(token);
    const selectedBoard = boards.find((board) => String(board.id) === boardId);

    if (!selectedBoard) {
      return res.status(404).json({ error: "Board not found" });
    }

    const persistedState = await tokenStore.saveState({
      board: {
        id: String(selectedBoard.id),
        name: selectedBoard.name,
        columns: selectedBoard.columns ?? [],
      },
    });

    return res.json({
      selected_board: persistedState.board,
    });
  });

  app.post("/leads", async (req, res) => {
    const state = await getPersistedState(tokenStore);
    const token = state.tokens?.monday_access_token ?? null;

    if (!token) {
      return res.status(409).json({ error: "Monday OAuth token not configured" });
    }

    if (!state.board?.id) {
      return res.status(409).json({ error: "Monday board not selected" });
    }

    let mappedLead;

    try {
      mappedLead = mapInternalLeadToMondayItem(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const createdItem = await mondayClient.createItem({
      token,
      boardId: state.board.id,
      itemName: mappedLead.itemName,
    });

    return res.status(201).json({
      board_id: state.board.id,
      item_id: createdItem?.id ?? null,
      item_name: mappedLead.itemName,
      lead: mappedLead.summary,
    });
  });

  return app;
}

module.exports = {
  createApp,
};
