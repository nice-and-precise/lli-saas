const crypto = require("crypto");
const express = require("express");
const {
  getLeadSchemaPath,
  mapLeadToMondayItemWithMapping,
  validateBoardMapping,
} = require("./leadContract");
const { MondayClient } = require("./mondayClient");
const {
  getOwnerRecordSchemaPath,
  normalizeMondayOwnerRecords,
} = require("./ownerRecord");
const { createDefaultMapping, DEFAULT_TENANT_ID, FileTokenStore } = require("./tokenStore");
const {
  FIELD_METADATA,
  buildValidationResponse,
  normalizeMappingInput,
  validateMondaySetup,
} = require("./validation");

const SOURCE_OWNER_BOARD_NAME = "Clients";

function normalizeDuplicateValue(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildDuplicateKey(value) {
  return normalizeDuplicateValue(value);
}

function buildLeadIdentity(lead) {
  const obituaryUrl = buildDuplicateKey(lead.obituary_url ?? lead.obituary?.url ?? "");
  const fallbackKey = buildDuplicateKey(
    [lead.deceased_name, lead.death_date ?? lead.obituary?.death_date ?? "", lead.owner_id]
      .filter(Boolean)
      .join("::"),
  );

  return {
    obituaryUrl,
    fallbackKey,
  };
}

function buildTransactionId(tenantId, lead) {
  const identity = buildLeadIdentity(lead);
  const hash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        tenant_id: tenantId,
        obituary_url: identity.obituaryUrl || null,
        fallback_key: identity.fallbackKey || null,
        scan_id: lead.scan_id ?? null,
        source: lead.source ?? null,
      }),
    )
    .digest("hex");

  return `leadtx_${hash}`;
}

function findExistingDeliveryByIdentity(deliveries, identity) {
  return (deliveries ?? []).find((delivery) => {
    if (identity.obituaryUrl && delivery.obituary_url && buildDuplicateKey(delivery.obituary_url) === identity.obituaryUrl) {
      return true;
    }

    return Boolean(
      identity.fallbackKey &&
        delivery.fallback_duplicate_key &&
        buildDuplicateKey(delivery.fallback_duplicate_key) === identity.fallbackKey,
    );
  });
}

function findExistingDeliveryByTransactionId(deliveries, transactionId) {
  return (deliveries ?? []).find((delivery) => delivery.transaction_id === transactionId);
}

function buildDeliveryRecord({
  tenantId,
  transactionId,
  boardId,
  lead,
  itemName,
  duplicateKey,
  obituaryUrl = null,
  fallbackDuplicateKey = null,
  status,
  itemId = null,
  duplicateOf = null,
  error = null,
}) {
  return {
    id: `delivery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tenant_id: tenantId,
    transaction_id: transactionId,
    scan_id: lead.scan_id,
    board_id: boardId,
    status,
    item_id: itemId,
    item_name: itemName,
    duplicate_of: duplicateOf,
    duplicate_key: duplicateKey,
    obituary_url: obituaryUrl,
    fallback_duplicate_key: fallbackDuplicateKey,
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

function createRuntimeVisibility({ tokenStore, mondayConfig }) {
  return {
    monday_oauth_configured: Object.values(mondayConfig).every(Boolean),
    source_owner_board_name: SOURCE_OWNER_BOARD_NAME,
    token_store_path: tokenStore.filePath ?? "memory",
  };
}

function getReadinessIssues({ mondayConfig }) {
  const issues = [];

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

function parseLimit(value, defaultValue = 10000) {
  if (value == null || value === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) {
    throw new Error("limit must be an integer between 1 and 10000");
  }

  return parsed;
}

function buildMondayRequestErrorResponse(error, fallbackMessage) {
  return {
    error: fallbackMessage,
    details: error.message,
  };
}

function buildPreviewState(state, payload = {}) {
  const nextBoardId =
    typeof payload.board_id === "string" && payload.board_id.trim() !== ""
      ? payload.board_id.trim()
      : state.board?.id
        ? String(state.board.id)
        : "";

  return {
    ...state,
    board: nextBoardId ? { id: nextBoardId } : null,
    board_mapping: normalizeMappingInput(payload.mapping, state.board_mapping ?? createDefaultMapping()),
  };
}

function createApp(options = {}) {
  const app = express();
  const tokenStore = options.tokenStore ?? new FileTokenStore();
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

  async function getValidationSnapshot(tenantId, overrides = {}) {
    const state = overrides.state ?? (await getPersistedState(tokenStore, tenantId));
    const validationResult = await validateMondaySetup({
      mondayClient,
      mondayConfig,
      state,
      sourceBoardName: SOURCE_OWNER_BOARD_NAME,
    });

    return buildValidationResponse({
      tenantId,
      preview: Boolean(overrides.preview),
      ...validationResult,
    });
  }

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
      mappedLead = mapLeadToMondayItemWithMapping(leadPayload, state.board_mapping, state.board.columns ?? []);
    } catch (error) {
      return {
        statusCode: 400,
        body: {
          error: error.message,
          details: "Lead payload validation failed before Monday delivery",
        },
      };
    }

    const transactionId = buildTransactionId(tenantId, mappedLead.summary);
    const identity = buildLeadIdentity(mappedLead.summary);
    const duplicateKey = identity.obituaryUrl || identity.fallbackKey || buildDuplicateKey(mappedLead.itemName);

    const persistedTransaction = findExistingDeliveryByTransactionId(state.deliveries, transactionId);
    if (persistedTransaction?.item_id) {
      const deliveryRecord = buildDeliveryRecord({
        tenantId,
        transactionId,
        boardId: state.board.id,
        lead: mappedLead.summary,
        itemName: mappedLead.itemName,
        duplicateKey,
        obituaryUrl: mappedLead.summary.obituary_url ?? null,
        fallbackDuplicateKey: identity.fallbackKey,
        status: "skipped_idempotent_retry",
        itemId: persistedTransaction.item_id,
        duplicateOf: persistedTransaction.item_id,
      });
      const scanRuns = upsertScanRun(state.scan_runs ?? [], deliveryRecord);
      await persistDeliveryState(tokenStore, tenantId, deliveryRecord, scanRuns);

      return {
        statusCode: 200,
        body: {
          tenant_id: tenantId,
          board_id: state.board.id,
          delivery_id: deliveryRecord.id,
          transaction_id: transactionId,
          status: deliveryRecord.status,
          item_id: deliveryRecord.item_id,
          item_name: mappedLead.itemName,
          duplicate_of: deliveryRecord.duplicate_of,
          lead: mappedLead.summary,
        },
      };
    }

    const persistedDuplicate = findExistingDeliveryByIdentity(state.deliveries, identity);
    if (persistedDuplicate?.item_id) {
      const deliveryRecord = buildDeliveryRecord({
        tenantId,
        transactionId,
        boardId: state.board.id,
        lead: mappedLead.summary,
        itemName: mappedLead.itemName,
        duplicateKey,
        obituaryUrl: mappedLead.summary.obituary_url ?? null,
        fallbackDuplicateKey: identity.fallbackKey,
        status: "skipped_duplicate",
        itemId: persistedDuplicate.item_id ?? null,
        duplicateOf: persistedDuplicate.item_id ?? persistedDuplicate.duplicate_of ?? null,
      });
      const scanRuns = upsertScanRun(state.scan_runs ?? [], deliveryRecord);
      await persistDeliveryState(tokenStore, tenantId, deliveryRecord, scanRuns);

      return {
        statusCode: 200,
        body: {
          tenant_id: tenantId,
          board_id: state.board.id,
          delivery_id: deliveryRecord.id,
          transaction_id: transactionId,
          status: deliveryRecord.status,
          item_id: deliveryRecord.item_id,
          item_name: mappedLead.itemName,
          duplicate_of: deliveryRecord.duplicate_of,
          lead: mappedLead.summary,
        },
      };
    }

    let existingItems;
    try {
      existingItems = await mondayClient.listBoardItems({
        token,
        boardId: state.board.id,
        limit: 10000,
      });
    } catch (error) {
      return {
        statusCode: 502,
        body: buildMondayRequestErrorResponse(error, "Failed to query Monday destination board"),
      };
    }
    const duplicateMatch = existingItems.find((item) => buildDuplicateKey(item.name) === duplicateKey);

    if (duplicateMatch) {
      const deliveryRecord = buildDeliveryRecord({
        tenantId,
        transactionId,
        boardId: state.board.id,
        lead: mappedLead.summary,
        itemName: mappedLead.itemName,
        duplicateKey,
        obituaryUrl: mappedLead.summary.obituary_url ?? null,
        fallbackDuplicateKey: identity.fallbackKey,
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
          transaction_id: transactionId,
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
        transactionId,
        boardId: state.board.id,
        lead: mappedLead.summary,
        itemName: mappedLead.itemName,
        duplicateKey,
        obituaryUrl: mappedLead.summary.obituary_url ?? null,
        fallbackDuplicateKey: identity.fallbackKey,
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
          transaction_id: transactionId,
          status: deliveryRecord.status,
          item_id: createdItem?.id ?? null,
          item_name: mappedLead.itemName,
          lead: mappedLead.summary,
        },
      };
    } catch (error) {
      const deliveryRecord = buildDeliveryRecord({
        tenantId,
        transactionId,
        boardId: state.board.id,
        lead: mappedLead.summary,
        itemName: mappedLead.itemName,
        duplicateKey,
        obituaryUrl: mappedLead.summary.obituary_url ?? null,
        fallbackDuplicateKey: identity.fallbackKey,
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
          transaction_id: transactionId,
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
        tokenStore,
        mondayConfig,
      }),
    });
  });

  app.get("/ready", (_req, res) => {
    const missingConfiguration = getReadinessIssues({
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
    res.json({
      lead_contract_path: getLeadSchemaPath(),
      owner_record_contract_path: getOwnerRecordSchemaPath(),
    });
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

  app.get("/boards", async (req, res) => {
    const tenantId = getTenantId(req);
    const state = await getPersistedState(tokenStore, tenantId);
    const token = state.tokens?.monday_access_token ?? null;

    if (!token) {
      return res.status(409).json({ error: "Monday OAuth token not configured" });
    }

    let boards;
    try {
      boards = await mondayClient.listBoards(token);
    } catch (error) {
      return res.status(502).json(buildMondayRequestErrorResponse(error, "Failed to query Monday boards"));
    }

    return res.json({
      boards,
      selected_board: state.board ?? null,
      tenant_id: tenantId,
    });
  });

  app.get("/owners", async (req, res) => {
    const tenantId = getTenantId(req);
    const state = await getPersistedState(tokenStore, tenantId);
    const token = state.tokens?.monday_access_token ?? null;

    if (!token) {
      return res.status(409).json({ error: "Monday OAuth token not configured" });
    }

    let limit;
    try {
      limit = parseLimit(req.query.limit);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    let boards;
    try {
      boards = await mondayClient.listBoards(token);
    } catch (error) {
      return res.status(502).json(buildMondayRequestErrorResponse(error, "Failed to query Monday boards"));
    }
    const sourceBoard = boards.find((board) => String(board.name).trim() === SOURCE_OWNER_BOARD_NAME);

    if (!sourceBoard) {
      return res.status(404).json({ error: `${SOURCE_OWNER_BOARD_NAME} board not found` });
    }

    let items;
    try {
      items = await mondayClient.listBoardItems({
        token,
        boardId: String(sourceBoard.id),
        limit,
      });
    } catch (error) {
      return res.status(502).json(buildMondayRequestErrorResponse(error, "Failed to fetch Monday owner records"));
    }

    let owners;
    try {
      owners = normalizeMondayOwnerRecords({
        boardId: String(sourceBoard.id),
        items,
      });
    } catch (error) {
      return res.status(502).json({
        error: "Failed to normalize Monday owner records",
        details: error.message,
      });
    }

    return res.json({
      tenant_id: tenantId,
      source_board: {
        id: String(sourceBoard.id),
        name: sourceBoard.name,
      },
      owner_count: owners.length,
      owners,
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

    let boards;
    try {
      boards = await mondayClient.listBoards(token);
    } catch (error) {
      return res.status(502).json(buildMondayRequestErrorResponse(error, "Failed to query Monday boards"));
    }
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
    const validation = await getValidationSnapshot(tenantId, { state: persistedState });

    return res.json({
      selected_board: persistedState.board,
      tenant_id: tenantId,
      validation,
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
      field_catalog: {
        crm_fields: (state.board?.columns ?? []).map((column) => ({
          id: String(column.id),
          label: column.title ?? String(column.id),
          type: column.type ?? "unknown",
          description: `CRM field available on ${state.board?.name ?? "the selected board"}.`,
          example: column.settings_str ? `Monday settings: ${String(column.settings_str).slice(0, 120)}` : null,
        })),
        lli_fields: Object.entries(FIELD_METADATA).map(([key, metadata]) => ({
          key,
          label: metadata.label,
          description: metadata.description ?? null,
          example: metadata.example ?? null,
          source_hint: metadata.sourceHint ?? null,
          recommended_types: metadata.recommendedTypes ?? [],
          aliases: metadata.aliases ?? [],
          required: ["deceased_name", "owner_name", "obituary_url", "match_score", "tier"].includes(key),
          mapped_column_id: state.board_mapping?.columns?.[key] ?? null,
        })),
      },
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
    const validation = await getValidationSnapshot(tenantId, { state: persistedState });

    return res.json({
      tenant_id: tenantId,
      board_id: state.board.id,
      mapping: persistedState.board_mapping,
      validation,
      field_catalog: {
        crm_fields: (persistedState.board?.columns ?? []).map((column) => ({
          id: String(column.id),
          label: column.title ?? String(column.id),
          type: column.type ?? "unknown",
          description: `CRM field available on ${persistedState.board?.name ?? "the selected board"}.`,
          example: column.settings_str ? `Monday settings: ${String(column.settings_str).slice(0, 120)}` : null,
        })),
        lli_fields: Object.entries(FIELD_METADATA).map(([key, metadata]) => ({
          key,
          label: metadata.label,
          description: metadata.description ?? null,
          example: metadata.example ?? null,
          source_hint: metadata.sourceHint ?? null,
          recommended_types: metadata.recommendedTypes ?? [],
          aliases: metadata.aliases ?? [],
          required: ["deceased_name", "owner_name", "obituary_url", "match_score", "tier"].includes(key),
          mapped_column_id: persistedState.board_mapping?.columns?.[key] ?? null,
        })),
      },
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

  app.get("/validation", async (req, res) => {
    const tenantId = getTenantId(req);
    const validation = await getValidationSnapshot(tenantId);

    return res.json(validation);
  });

  app.post("/validation/preview", async (req, res) => {
    const tenantId = getTenantId(req);
    const state = await getPersistedState(tokenStore, tenantId);
    const previewState = buildPreviewState(state, req.body ?? {});
    const validation = await getValidationSnapshot(tenantId, {
      state: previewState,
      preview: true,
    });

    return res.json(validation);
  });

  app.post("/leads", async (req, res) => {
    const tenantId = getTenantId(req);
    const deliveryResult = await deliverLead(tenantId, req.body);
    return res.status(deliveryResult.statusCode).json(deliveryResult.body);
  });

  return app;
}

module.exports = {
  SOURCE_OWNER_BOARD_NAME,
  buildTransactionId,
  createApp,
  getPersistedState,
};
