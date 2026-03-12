const express = require("express");
const {
  getInternalLeadSchemaPath,
  mapInternalLeadToMondayItemWithMapping,
  validateBoardMapping,
} = require("./internalLead");
const { MondayClient } = require("./mondayClient");
const { createDefaultMapping, DEFAULT_TENANT_ID, FileTokenStore } = require("./tokenStore");

function normalizeDuplicateValue(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildDuplicateKey(value) {
  return normalizeDuplicateValue(value);
}

function buildDeliveryRecord({
  tenantId,
  boardId,
  lead,
  itemName,
  duplicateKey,
  status,
  itemId = null,
  duplicateOf = null,
  error = null,
}) {
  return {
    id: `delivery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tenant_id: tenantId,
    scan_id: lead.scan_id,
    board_id: boardId,
    status,
    item_id: itemId,
    item_name: itemName,
    duplicate_of: duplicateOf,
    duplicate_key: duplicateKey,
    summary: lead,
    error,
    delivered_at: new Date().toISOString(),
  };
}

function upsertScanRun(scanRuns, deliveryRecord) {
  const existingScanRun = scanRuns.find((scanRun) => scanRun.scan_id === deliveryRecord.scan_id);

  if (!existingScanRun) {
    return [
      {
        scan_id: deliveryRecord.scan_id,
        tenant_id: deliveryRecord.tenant_id,
        board_id: deliveryRecord.board_id,
        last_delivery_at: deliveryRecord.delivered_at,
        last_delivery_status: deliveryRecord.status,
        lead_count: 1,
        delivery_ids: [deliveryRecord.id],
      },
      ...scanRuns,
    ];
  }

  return scanRuns.map((scanRun) =>
    scanRun.scan_id === deliveryRecord.scan_id
      ? {
          ...scanRun,
          last_delivery_at: deliveryRecord.delivered_at,
          last_delivery_status: deliveryRecord.status,
          lead_count: Number(scanRun.lead_count ?? 0) + 1,
          delivery_ids: [...(scanRun.delivery_ids ?? []), deliveryRecord.id],
        }
      : scanRun,
  );
}

async function persistDeliveryState(tokenStore, tenantId, deliveryRecord, scanRuns) {
  const tenantState = await tokenStore.getTenantState(tenantId);
  const deliveries = [deliveryRecord, ...(tenantState.deliveries ?? [])].slice(0, 50);

  await tokenStore.saveTenantState(tenantId, {
    deliveries,
    scan_runs: scanRuns,
  });
}

function createStatusSnapshot(state, tenantId) {
  return {
    tenant_id: tenantId,
    board: state.board ?? null,
    board_mapping: state.board_mapping ?? createDefaultMapping(),
    deliveries: state.deliveries ?? [],
    scan_runs: state.scan_runs ?? [],
    latest_delivery: state.deliveries?.[0] ?? null,
  };
}

function createRuntimeVisibility({
  leadEngineBaseUrl,
  tokenStore,
  mondayConfig,
}) {
  return {
    lead_engine_base_url: leadEngineBaseUrl,
    monday_oauth_configured: Object.values(mondayConfig).every(Boolean),
    token_store_path: tokenStore.filePath ?? "memory",
  };
}

function getReadinessIssues({ leadEngineBaseUrl, mondayConfig }) {
  const issues = [];

  if (!leadEngineBaseUrl) {
    issues.push("LEAD_ENGINE_BASE_URL");
  }

  Object.entries(mondayConfig).forEach(([key, value]) => {
    if (!value) {
      issues.push(key);
    }
  });

  return issues;
}

async function getPersistedState(tokenStore, tenantId = DEFAULT_TENANT_ID) {
  if (typeof tokenStore.getState === "function") {
    const state = await tokenStore.getState();
    const tenantState =
      typeof tokenStore.getTenantState === "function"
        ? await tokenStore.getTenantState(tenantId)
        : {
            oauth: {
              access_token: state.tokens?.monday_access_token ?? null,
              account_id: state.account_id ?? null,
            },
            selected_board: state.board ?? null,
            board_mapping: state.board_mapping ?? createDefaultMapping(),
            scan_runs: state.scan_runs ?? [],
            deliveries: state.deliveries ?? [],
            tenant_id: tenantId,
          };

    return {
      ...state,
      tenant_id: tenantId,
      tokens: {
        monday_access_token: tenantState.oauth?.access_token ?? state.tokens?.monday_access_token ?? null,
      },
      account_id: tenantState.oauth?.account_id ?? state.account_id ?? null,
      board: tenantState.selected_board ?? state.board ?? null,
      board_mapping: tenantState.board_mapping ?? state.board_mapping ?? createDefaultMapping(),
      scan_runs: tenantState.scan_runs ?? state.scan_runs ?? [],
      deliveries: tenantState.deliveries ?? state.deliveries ?? [],
    };
  }

  const token =
    typeof tokenStore.get === "function" ? await tokenStore.get("monday_access_token") : null;

  return {
    tokens: token ? { monday_access_token: token } : {},
    board: null,
    account_id: null,
    board_mapping: createDefaultMapping(),
    scan_runs: [],
    deliveries: [],
    updated_at: null,
    tenant_id: tenantId,
  };
}

function getTenantId(req) {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId === "string" && tenantId.trim() !== "") {
    return tenantId.trim();
  }

  return DEFAULT_TENANT_ID;
}

function createApp(options = {}) {
  const app = express();
  const tokenStore = options.tokenStore ?? new FileTokenStore();
  const fetchImpl = options.fetchImpl ?? fetch;
  const leadEngineBaseUrl = options.leadEngineBaseUrl ?? process.env.LEAD_ENGINE_BASE_URL ?? "http://localhost:8000";
  const mondayConfig = {
    MONDAY_CLIENT_ID: options.clientId ?? process.env.MONDAY_CLIENT_ID ?? "",
    MONDAY_CLIENT_SECRET: options.clientSecret ?? process.env.MONDAY_CLIENT_SECRET ?? "",
    MONDAY_REDIRECT_URI: options.redirectUri ?? process.env.MONDAY_REDIRECT_URI ?? "",
  };
  const mondayClient =
    options.mondayClient ??
    new MondayClient({
      clientId: mondayConfig.MONDAY_CLIENT_ID,
      clientSecret: mondayConfig.MONDAY_CLIENT_SECRET,
      redirectUri: mondayConfig.MONDAY_REDIRECT_URI,
      apiBaseUrl: options.apiBaseUrl ?? process.env.MONDAY_API_BASE_URL,
    });

  app.use(express.json());

  async function deliverLead(tenantId, leadPayload) {
    const state = await getPersistedState(tokenStore, tenantId);
    const token = state.tokens?.monday_access_token ?? null;

    if (!token) {
      return {
        statusCode: 409,
        body: { error: "Monday OAuth token not configured" },
      };
    }

    if (!state.board?.id) {
      return {
        statusCode: 409,
        body: { error: "Monday board not selected" },
      };
    }

    let mappedLead;

    try {
      mappedLead = mapInternalLeadToMondayItemWithMapping(leadPayload, state.board_mapping);
    } catch (error) {
      return {
        statusCode: 400,
        body: { error: error.message },
      };
    }

    const duplicateKey = buildDuplicateKey(mappedLead.itemName);
    const existingItems = await mondayClient.listBoardItems({
      token,
      boardId: state.board.id,
    });
    const duplicateMatch = existingItems.find((item) => buildDuplicateKey(item.name) === duplicateKey);

    if (duplicateMatch) {
      const deliveryRecord = buildDeliveryRecord({
        tenantId,
        boardId: state.board.id,
        lead: mappedLead.summary,
        itemName: mappedLead.itemName,
        duplicateKey,
        status: "skipped_duplicate",
        itemId: duplicateMatch.id ?? null,
        duplicateOf: duplicateMatch.id ?? null,
      });
      const scanRuns = upsertScanRun(state.scan_runs ?? [], deliveryRecord);
      await persistDeliveryState(tokenStore, tenantId, deliveryRecord, scanRuns);

      return {
        statusCode: 200,
        body: {
          tenant_id: tenantId,
          board_id: state.board.id,
          delivery_id: deliveryRecord.id,
          status: deliveryRecord.status,
          item_id: duplicateMatch.id ?? null,
          item_name: mappedLead.itemName,
          duplicate_of: duplicateMatch.id ?? null,
          lead: mappedLead.summary,
        },
      };
    }

    try {
      const createdItem = await mondayClient.createItem({
        token,
        boardId: state.board.id,
        itemName: mappedLead.itemName,
        columnValues: mappedLead.columnValues,
      });
      const deliveryRecord = buildDeliveryRecord({
        tenantId,
        boardId: state.board.id,
        lead: mappedLead.summary,
        itemName: mappedLead.itemName,
        duplicateKey,
        status: "created",
        itemId: createdItem?.id ?? null,
      });
      const scanRuns = upsertScanRun(state.scan_runs ?? [], deliveryRecord);
      await persistDeliveryState(tokenStore, tenantId, deliveryRecord, scanRuns);

      return {
        statusCode: 201,
        body: {
          tenant_id: tenantId,
          board_id: state.board.id,
          delivery_id: deliveryRecord.id,
          status: deliveryRecord.status,
          item_id: createdItem?.id ?? null,
          item_name: mappedLead.itemName,
          lead: mappedLead.summary,
        },
      };
    } catch (error) {
      const deliveryRecord = buildDeliveryRecord({
        tenantId,
        boardId: state.board.id,
        lead: mappedLead.summary,
        itemName: mappedLead.itemName,
        duplicateKey,
        status: "failed",
        error: error.message,
      });
      const scanRuns = upsertScanRun(state.scan_runs ?? [], deliveryRecord);
      await persistDeliveryState(tokenStore, tenantId, deliveryRecord, scanRuns);

      return {
        statusCode: 502,
        body: {
          error: "Monday lead delivery failed",
          tenant_id: tenantId,
          board_id: state.board.id,
          delivery_id: deliveryRecord.id,
          status: deliveryRecord.status,
          lead: mappedLead.summary,
        },
      };
    }
  }

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "crm-adapter",
      ...createRuntimeVisibility({
        leadEngineBaseUrl,
        tokenStore,
        mondayConfig,
      }),
    });
  });

  app.get("/ready", (_req, res) => {
    const missingConfiguration = getReadinessIssues({
      leadEngineBaseUrl,
      mondayConfig,
    });

    if (missingConfiguration.length > 0) {
      return res.status(503).json({
        status: "not_ready",
        service: "crm-adapter",
        missing_configuration: missingConfiguration,
      });
    }

    return res.json({
      status: "ready",
      service: "crm-adapter",
    });
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
    const tenantId = getTenantId(_req);
    const state = await getPersistedState(tokenStore, tenantId);
    const token = state.tokens?.monday_access_token ?? null;

    if (!token) {
      return res.status(409).json({ error: "Monday OAuth token not configured" });
    }

    const boards = await mondayClient.listBoards(token);

    return res.json({
      boards,
      selected_board: state.board ?? null,
      tenant_id: tenantId,
    });
  });

  app.post("/boards/select", async (req, res) => {
    const tenantId = getTenantId(req);
    const { board_id: boardId } = req.body ?? {};

    if (typeof boardId !== "string" || boardId.trim() === "") {
      return res.status(400).json({ error: "board_id is required" });
    }

    const state = await getPersistedState(tokenStore, tenantId);
    const token = state.tokens?.monday_access_token ?? null;

    if (!token) {
      return res.status(409).json({ error: "Monday OAuth token not configured" });
    }

    const boards = await mondayClient.listBoards(token);
    const selectedBoard = boards.find((board) => String(board.id) === boardId);

    if (!selectedBoard) {
      return res.status(404).json({ error: "Board not found" });
    }

    const persistedState = await tokenStore.saveTenantState(tenantId, {
      board: {
        id: String(selectedBoard.id),
        name: selectedBoard.name,
        columns: selectedBoard.columns ?? [],
      },
    });

    return res.json({
      selected_board: persistedState.board,
      tenant_id: tenantId,
    });
  });

  app.get("/mapping", async (req, res) => {
    const tenantId = getTenantId(req);
    const state = await getPersistedState(tokenStore, tenantId);

    if (!state.board?.id) {
      return res.status(409).json({ error: "Monday board not selected" });
    }

    return res.json({
      tenant_id: tenantId,
      board_id: state.board.id,
      mapping: state.board_mapping ?? createDefaultMapping(),
    });
  });

  app.put("/mapping", async (req, res) => {
    const tenantId = getTenantId(req);
    const state = await getPersistedState(tokenStore, tenantId);

    if (!state.board?.id) {
      return res.status(409).json({ error: "Monday board not selected" });
    }

    try {
      validateBoardMapping(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const persistedState = await tokenStore.saveTenantState(tenantId, {
      board_mapping: req.body,
    });

    return res.json({
      tenant_id: tenantId,
      board_id: state.board.id,
      mapping: persistedState.board_mapping,
    });
  });

  app.get("/deliveries", async (req, res) => {
    const tenantId = getTenantId(req);
    const state = await getPersistedState(tokenStore, tenantId);

    return res.json({
      tenant_id: tenantId,
      board_id: state.board?.id ?? null,
      deliveries: state.deliveries ?? [],
      scan_runs: state.scan_runs ?? [],
    });
  });

  app.get("/status", async (req, res) => {
    const tenantId = getTenantId(req);
    const state = await getPersistedState(tokenStore, tenantId);

    return res.json(createStatusSnapshot(state, tenantId));
  });

  app.post("/first-scan", async (req, res) => {
    const tenantId = getTenantId(req);
    const scanResponse = await fetchImpl(`${leadEngineBaseUrl}/run-scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body ?? {}),
    });
    const scanPayload = await scanResponse.json();

    if (!scanResponse.ok || scanPayload.status === "failed") {
      return res.status(502).json({
        error: "Lead engine scan failed",
        tenant_id: tenantId,
        scan: scanPayload,
      });
    }

    const deliveries = [];
    for (const lead of scanPayload.leads ?? []) {
      const deliveryResult = await deliverLead(tenantId, lead);
      deliveries.push(deliveryResult.body);
    }

    const state = await getPersistedState(tokenStore, tenantId);
    const totals = deliveries.reduce(
      (summary, delivery) => {
        if (delivery.status === "created") {
          summary.created += 1;
        } else if (delivery.status === "skipped_duplicate") {
          summary.skipped_duplicate += 1;
        } else if (delivery.status === "failed") {
          summary.failed += 1;
        }
        return summary;
      },
      { created: 0, skipped_duplicate: 0, failed: 0 },
    );

    return res.status(200).json({
      tenant_id: tenantId,
      scan_id: scanPayload.scan_id ?? null,
      scan_status: scanPayload.status ?? "completed",
      lead_count: scanPayload.lead_count ?? deliveries.length,
      totals,
      deliveries,
      status: createStatusSnapshot(state, tenantId),
    });
  });

  app.post("/leads", async (req, res) => {
    const tenantId = getTenantId(req);
    const deliveryResult = await deliverLead(tenantId, req.body);
    return res.status(deliveryResult.statusCode).json(deliveryResult.body);
  });

  return app;
}

module.exports = {
  createApp,
  getPersistedState,
};
