const crypto = require("crypto");
const express = require("express");
const {
  getAuthConfig,
  getBearerToken,
  normalizeAllowedOrigins,
  requireOperatorCredentials,
  signJwt,
  signOAuthState,
  verifyJwt,
} = require("./auth");
const {
  getLeadSchemaPath,
  mapLeadToMondayItemWithMapping,
  validateBoardMapping,
} = require("./leadContract");
const { MondayClient } = require("./mondayClient");
const { getOwnerRecordSchemaPath, normalizeMondayOwnerRecords } = require("./ownerRecord");
const { createLogger } = require("./logger");
const {
  createDefaultMapping,
  DEFAULT_TENANT_ID,
  FileTokenStore,
  TokenStoreError,
} = require("./tokenStore");

const SOURCE_OWNER_BOARD_NAME = process.env.SOURCE_OWNER_BOARD_NAME || "Clients";
const MAX_DELIVERY_HISTORY = parseInt(process.env.MAX_DELIVERY_HISTORY, 10) || 200;
const MAX_SCAN_RUN_HISTORY = parseInt(process.env.MAX_SCAN_RUN_HISTORY, 10) || 100;

function canonicalizeUrl(value) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) {
    return "";
  }

  try {
    const parsed = new URL(rawValue);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.protocol = parsed.protocol.toLowerCase();
    return parsed.toString();
  } catch (_error) {
    return rawValue;
  }
}

function normalizeDuplicateValue(value) {
  return canonicalizeUrl(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildDuplicateKey(value) {
  return normalizeDuplicateValue(value);
}

function buildLeadIdentity(lead, tenantId) {
  const obituaryUrl = buildDuplicateKey(
    canonicalizeUrl(lead.obituary_url ?? lead.obituary?.url ?? ""),
  );
  const fallbackKey = buildDuplicateKey(
    [
      lead.deceased_name,
      lead.death_date ?? lead.obituary?.death_date ?? "",
      lead.owner_id,
      lead.obituary_source ?? lead.obituary?.source_id ?? "",
    ]
      .filter(Boolean)
      .join("::"),
  );
  const canonicalIdentity = {
    tenant_id: tenantId,
    owner_id: buildDuplicateKey(lead.owner_id),
    deceased_name: buildDuplicateKey(lead.deceased_name),
    death_date: buildDuplicateKey(lead.death_date ?? lead.obituary?.death_date ?? ""),
    obituary_source: buildDuplicateKey(lead.obituary_source ?? lead.obituary?.source_id ?? ""),
    obituary_url: buildDuplicateKey(obituaryUrl),
    county: buildDuplicateKey(lead.county ?? lead.property?.county ?? ""),
    source: buildDuplicateKey(lead.source),
  };
  const idempotencyKey = `lead:v1:${crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalIdentity))
    .digest("hex")}`;

  return {
    idempotencyKey,
    obituaryUrl,
    fallbackKey,
  };
}

function findExistingDeliveryByIdentity(deliveries, identity) {
  return (deliveries ?? []).find((delivery) => {
    if (
      identity.idempotencyKey &&
      delivery.idempotency_key &&
      delivery.idempotency_key === identity.idempotencyKey
    ) {
      return true;
    }

    if (
      identity.obituaryUrl &&
      delivery.obituary_url &&
      buildDuplicateKey(delivery.obituary_url) === identity.obituaryUrl
    ) {
      return true;
    }

    return Boolean(
      identity.fallbackKey &&
      delivery.fallback_duplicate_key &&
      buildDuplicateKey(delivery.fallback_duplicate_key) === identity.fallbackKey,
    );
  });
}

function buildDeliveryRecord({
  tenantId,
  boardId,
  lead,
  itemName,
  duplicateKey,
  idempotencyKey,
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
    scan_id: lead.scan_id,
    board_id: boardId,
    status,
    item_id: itemId,
    item_name: itemName,
    duplicate_of: duplicateOf,
    duplicate_key: duplicateKey,
    idempotency_key: idempotencyKey,
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

function buildIdempotencyEntry(deliveryRecord, currentEntry = null) {
  return {
    delivery_id: deliveryRecord.id,
    item_id: deliveryRecord.item_id ?? currentEntry?.item_id ?? null,
    status: deliveryRecord.status,
    item_name: deliveryRecord.item_name,
    scan_id: deliveryRecord.scan_id ?? currentEntry?.scan_id ?? null,
    obituary_url: deliveryRecord.obituary_url ?? currentEntry?.obituary_url ?? null,
    fallback_duplicate_key:
      deliveryRecord.fallback_duplicate_key ?? currentEntry?.fallback_duplicate_key ?? null,
    first_seen_at: currentEntry?.first_seen_at ?? deliveryRecord.delivered_at,
    last_seen_at: deliveryRecord.delivered_at,
  };
}

function upsertIdempotencyIndex(index, deliveryRecord) {
  if (
    !deliveryRecord.idempotency_key ||
    !["created", "skipped_duplicate"].includes(deliveryRecord.status)
  ) {
    return index ?? {};
  }

  const currentEntry = index?.[deliveryRecord.idempotency_key] ?? null;
  return {
    ...(index ?? {}),
    [deliveryRecord.idempotency_key]: buildIdempotencyEntry(deliveryRecord, currentEntry),
  };
}

async function persistDeliveryState(tokenStore, tenantId, deliveryRecord) {
  const persistState = async (tenantState) => {
    const deliveries = [deliveryRecord, ...(tenantState.deliveries ?? [])].slice(
      0,
      MAX_DELIVERY_HISTORY,
    );
    const scanRuns = upsertScanRun(tenantState.scan_runs ?? [], deliveryRecord).slice(
      0,
      MAX_SCAN_RUN_HISTORY,
    );

    return {
      deliveries,
      scan_runs: scanRuns,
      idempotency_index: upsertIdempotencyIndex(
        tenantState.idempotency_index ?? {},
        deliveryRecord,
      ),
    };
  };

  if (typeof tokenStore.updateTenantState === "function") {
    await tokenStore.updateTenantState(tenantId, persistState);
    return;
  }

  const tenantState = await tokenStore.getTenantState(tenantId);
  await tokenStore.saveTenantState(tenantId, await persistState(tenantState));
}

function getIdempotencyMatchFromState(tenantState, identity) {
  if (identity.idempotencyKey && tenantState.idempotency_index?.[identity.idempotencyKey]) {
    return tenantState.idempotency_index[identity.idempotencyKey];
  }

  return findExistingDeliveryByIdentity(tenantState.deliveries, identity);
}

function parseMondayColumnValue(columnValue) {
  if (!columnValue) {
    return "";
  }

  if (typeof columnValue.value === "string" && columnValue.value.trim() !== "") {
    try {
      const parsed = JSON.parse(columnValue.value);
      if (typeof parsed === "string") {
        return parsed;
      }
      if (parsed?.url) {
        return parsed.url;
      }
      if (parsed?.text) {
        return parsed.text;
      }
    } catch (_error) {
      return columnValue.value;
    }
  }

  return columnValue.text ?? "";
}

function findBoardDuplicate(existingItems, identity, boardMapping, itemNameDuplicateKey) {
  const idempotencyColumnId = boardMapping?.columns?.idempotency_key;
  if (idempotencyColumnId) {
    const duplicate = existingItems.find((item) =>
      (item.column_values ?? []).some(
        (columnValue) =>
          String(columnValue.id) === String(idempotencyColumnId) &&
          String(parseMondayColumnValue(columnValue)).trim() === identity.idempotencyKey,
      ),
    );
    if (duplicate) {
      return duplicate;
    }
  }

  const obituaryUrlColumnId = boardMapping?.columns?.obituary_url;
  if (identity.obituaryUrl && obituaryUrlColumnId) {
    const duplicate = existingItems.find((item) =>
      (item.column_values ?? []).some(
        (columnValue) =>
          String(columnValue.id) === String(obituaryUrlColumnId) &&
          canonicalizeUrl(parseMondayColumnValue(columnValue)) === identity.obituaryUrl,
      ),
    );
    if (duplicate) {
      return duplicate;
    }
  }

  return existingItems.find((item) => buildDuplicateKey(item.name) === itemNameDuplicateKey);
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
        monday_access_token:
          tenantState.oauth?.access_token ?? state.tokens?.monday_access_token ?? null,
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

function getVerifiedTenantId(req) {
  return req.auth?.tenant_id ?? DEFAULT_TENANT_ID;
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

function buildStateErrorResponse(error) {
  return {
    error: "CRM adapter state unavailable",
    code: error.code,
    details: error.message,
    ...(error.statePath ? { state_path: error.statePath } : {}),
    ...(error.quarantinePath ? { quarantine_path: error.quarantinePath } : {}),
  };
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createApp(options = {}) {
  const app = express();
  const tokenStore = options.tokenStore ?? new FileTokenStore();
  const logger = options.logger ?? createLogger("crm-adapter");
  const authConfig = getAuthConfig(options.auth ?? {});
  const allowedOrigins = new Set(
    options.allowedOrigins ?? normalizeAllowedOrigins(process.env.AUTH_ALLOWED_ORIGINS),
  );
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

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      if (!allowedOrigins.has(origin)) {
        if (req.method === "OPTIONS") {
          return res.status(403).json({ error: "Origin not allowed" });
        }

        return res.status(403).json({ error: "Origin not allowed" });
      }

      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
    }
    res.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");

    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }

    next();
  });
  app.use(express.json());

  app.use((req, res, next) => {
    // Monday redirects back without an operator bearer token, so the callback stays public
    // and relies on the signed OAuth state minted by the authenticated login start route.
    if (
      req.path === "/health" ||
      req.path === "/ready" ||
      req.path === "/session/login" ||
      req.path === "/auth/callback"
    ) {
      return next();
    }

    const bearerToken = getBearerToken(req);
    if (!bearerToken) {
      return res.status(401).json({ error: "Missing bearer token" });
    }

    try {
      const claims = verifyJwt(bearerToken, authConfig);
      const requestedTenantId = req.headers["x-tenant-id"];
      if (
        typeof requestedTenantId === "string" &&
        requestedTenantId.trim() !== "" &&
        requestedTenantId.trim() !== claims.tenant_id
      ) {
        return res.status(400).json({ error: "x-tenant-id does not match authenticated tenant" });
      }

      req.auth = claims;
      req.bearerToken = bearerToken;
      return next();
    } catch (error) {
      return res.status(401).json({ error: "Invalid bearer token", details: error.message });
    }
  });

  async function deliverLead(tenantId, leadPayload) {
    const state = await getPersistedState(tokenStore, tenantId);
    const token = state.tokens?.monday_access_token ?? null;
    const scanId = leadPayload?.scan_id ?? null;

    if (!token) {
      logger.warn("crm_adapter_delivery_rejected", {
        tenant_id: tenantId,
        scan_id: scanId,
        reason: "missing_oauth_token",
      });
      return {
        statusCode: 409,
        body: { error: "Monday OAuth token not configured" },
      };
    }

    if (!state.board?.id) {
      logger.warn("crm_adapter_delivery_rejected", {
        tenant_id: tenantId,
        scan_id: scanId,
        reason: "missing_board_selection",
      });
      return {
        statusCode: 409,
        body: { error: "Monday board not selected" },
      };
    }

    let mappedLead;

    try {
      mappedLead = mapLeadToMondayItemWithMapping(
        leadPayload,
        state.board_mapping,
        state.board.columns ?? [],
      );
    } catch (error) {
      logger.warn("crm_adapter_delivery_rejected", {
        tenant_id: tenantId,
        scan_id: scanId,
        reason: "invalid_lead_payload",
        details: error.message,
      });
      return {
        statusCode: 400,
        body: { error: error.message },
      };
    }

    const identity = buildLeadIdentity(mappedLead.summary, tenantId);
    mappedLead.summary.idempotency_key = identity.idempotencyKey;
    if (state.board_mapping?.columns?.idempotency_key) {
      mappedLead.columnValues[state.board_mapping.columns.idempotency_key] =
        identity.idempotencyKey;
    }

    const duplicateKey =
      identity.obituaryUrl || identity.fallbackKey || buildDuplicateKey(mappedLead.itemName);

    logger.info("crm_adapter_delivery_attempt", {
      tenant_id: tenantId,
      scan_id: scanId,
      board_id: state.board.id,
      item_name: mappedLead.itemName,
      idempotency_key: identity.idempotencyKey,
    });

    const tenantState = await tokenStore.getTenantState(tenantId);
    const persistedDuplicate = getIdempotencyMatchFromState(tenantState, identity);
    if (persistedDuplicate) {
      const deliveryRecord = buildDeliveryRecord({
        tenantId,
        boardId: state.board.id,
        lead: mappedLead.summary,
        itemName: mappedLead.itemName,
        duplicateKey,
        idempotencyKey: identity.idempotencyKey,
        obituaryUrl: mappedLead.summary.obituary_url ?? null,
        fallbackDuplicateKey: identity.fallbackKey,
        status: "skipped_duplicate",
        itemId: persistedDuplicate.item_id ?? null,
        duplicateOf: persistedDuplicate.item_id ?? persistedDuplicate.duplicate_of ?? null,
      });
      await persistDeliveryState(tokenStore, tenantId, deliveryRecord);
      logger.info("crm_adapter_duplicate_skipped", {
        tenant_id: tenantId,
        scan_id: scanId,
        board_id: state.board.id,
        duplicate_source: "state",
        duplicate_of: deliveryRecord.duplicate_of,
        idempotency_key: identity.idempotencyKey,
      });

      return {
        statusCode: 200,
        body: {
          tenant_id: tenantId,
          board_id: state.board.id,
          delivery_id: deliveryRecord.id,
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
        context: {
          tenant_id: tenantId,
          scan_id: scanId,
        },
      });
    } catch (error) {
      logger.error("crm_adapter_delivery_board_query_failed", {
        tenant_id: tenantId,
        scan_id: scanId,
        board_id: state.board.id,
        error: error.message,
      });
      return {
        statusCode: 502,
        body: buildMondayRequestErrorResponse(error, "Failed to query Monday destination board"),
      };
    }
    const duplicateMatch = findBoardDuplicate(
      existingItems,
      identity,
      state.board_mapping,
      buildDuplicateKey(mappedLead.itemName),
    );

    if (duplicateMatch) {
      const deliveryRecord = buildDeliveryRecord({
        tenantId,
        boardId: state.board.id,
        lead: mappedLead.summary,
        itemName: mappedLead.itemName,
        duplicateKey,
        idempotencyKey: identity.idempotencyKey,
        obituaryUrl: mappedLead.summary.obituary_url ?? null,
        fallbackDuplicateKey: identity.fallbackKey,
        status: "skipped_duplicate",
        itemId: duplicateMatch.id ?? null,
        duplicateOf: duplicateMatch.id ?? null,
      });
      await persistDeliveryState(tokenStore, tenantId, deliveryRecord);
      logger.info("crm_adapter_duplicate_skipped", {
        tenant_id: tenantId,
        scan_id: scanId,
        board_id: state.board.id,
        duplicate_source: "board",
        duplicate_of: duplicateMatch.id ?? null,
        idempotency_key: identity.idempotencyKey,
      });

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
        context: {
          tenant_id: tenantId,
          scan_id: scanId,
        },
      });
      const deliveryRecord = buildDeliveryRecord({
        tenantId,
        boardId: state.board.id,
        lead: mappedLead.summary,
        itemName: mappedLead.itemName,
        duplicateKey,
        idempotencyKey: identity.idempotencyKey,
        obituaryUrl: mappedLead.summary.obituary_url ?? null,
        fallbackDuplicateKey: identity.fallbackKey,
        status: "created",
        itemId: createdItem?.id ?? null,
      });
      await persistDeliveryState(tokenStore, tenantId, deliveryRecord);
      logger.info("crm_adapter_delivery_succeeded", {
        tenant_id: tenantId,
        scan_id: scanId,
        board_id: state.board.id,
        item_id: createdItem?.id ?? null,
        idempotency_key: identity.idempotencyKey,
      });

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
        idempotencyKey: identity.idempotencyKey,
        obituaryUrl: mappedLead.summary.obituary_url ?? null,
        fallbackDuplicateKey: identity.fallbackKey,
        status: "failed",
        error: error.message,
      });
      await persistDeliveryState(tokenStore, tenantId, deliveryRecord);
      logger.error("crm_adapter_delivery_failed", {
        tenant_id: tenantId,
        scan_id: scanId,
        board_id: state.board.id,
        idempotency_key: identity.idempotencyKey,
        error: error.message,
      });

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

  app.post("/session/login", (req, res) => {
    const { email, password } = req.body ?? {};
    const credentialCheck = requireOperatorCredentials(authConfig, email, password);
    if (!credentialCheck.ok) {
      const statusCode =
        credentialCheck.reason === "operator_credentials_not_configured" ? 503 : 401;
      return res.status(statusCode).json({ error: credentialCheck.reason });
    }

    const token = signJwt(
      {
        sub: String(email).trim().toLowerCase(),
        role: authConfig.operatorRole,
        tenant_id: authConfig.operatorTenantId,
      },
      authConfig,
    );

    return res.json({
      access_token: token,
      token_type: "Bearer",
      expires_in: authConfig.tokenTtlSeconds,
      claims: {
        sub: String(email).trim().toLowerCase(),
        role: authConfig.operatorRole,
        tenant_id: authConfig.operatorTenantId,
        aud: authConfig.audience,
        iss: authConfig.issuer,
      },
    });
  });

  app.get("/session/me", (req, res) => {
    res.json({
      sub: req.auth.sub,
      role: req.auth.role,
      tenant_id: req.auth.tenant_id,
      aud: req.auth.aud,
      iss: req.auth.iss,
      exp: req.auth.exp,
    });
  });

  app.get("/auth/login", (req, res) => {
    const state = signOAuthState(
      {
        sub: req.auth.sub,
        role: req.auth.role,
        tenant_id: req.auth.tenant_id,
      },
      authConfig,
    );
    const location = mondayClient.getAuthorizationUrl(state);
    res.redirect(location);
  });

  app.get("/auth/login-url", (req, res) => {
    const state = signOAuthState(
      {
        sub: req.auth.sub,
        role: req.auth.role,
        tenant_id: req.auth.tenant_id,
      },
      authConfig,
    );

    return res.json({
      authorization_url: mondayClient.getAuthorizationUrl(state),
    });
  });

  app.get(
    "/auth/callback",
    asyncRoute(async (req, res) => {
      const { code, state } = req.query;

      if (!code) {
        logger.warn("crm_adapter_oauth_callback_rejected", {
          reason: "missing_code",
        });
        return res.status(400).json({ error: "Missing OAuth code" });
      }
      if (!state || typeof state !== "string") {
        logger.warn("crm_adapter_oauth_callback_rejected", {
          reason: "missing_state",
        });
        return res.status(400).json({ error: "Missing OAuth state" });
      }

      let claims;
      try {
        claims = verifyJwt(state, authConfig, { audience: "monday-oauth" });
      } catch (error) {
        logger.warn("crm_adapter_oauth_callback_rejected", {
          reason: "invalid_state",
          error: error.message,
        });
        return res.status(401).json({ error: "Invalid OAuth state", details: error.message });
      }

      let tokenPayload;
      try {
        tokenPayload = await mondayClient.exchangeCodeForToken(code);
      } catch (error) {
        logger.error("crm_adapter_oauth_exchange_failed", {
          tenant_id: claims.tenant_id,
          error: error.message,
        });
        return res.status(502).json({
          error: "Failed to exchange Monday OAuth code",
          details: error.message,
        });
      }
      if (typeof tokenStore.saveTenantState === "function") {
        await tokenStore.saveTenantState(claims.tenant_id, {
          oauth: {
            access_token: tokenPayload.access_token,
            account_id: tokenPayload.account_id ?? null,
          },
        });
      } else {
        await tokenStore.save("monday_access_token", tokenPayload.access_token);
        if (typeof tokenStore.saveState === "function") {
          await tokenStore.saveState({
            active_tenant_id: claims.tenant_id,
            tokens: {
              monday_access_token: tokenPayload.access_token,
            },
            account_id: tokenPayload.account_id ?? null,
          });
        }
      }

      logger.info("crm_adapter_oauth_connected", {
        tenant_id: claims.tenant_id,
        account_id: tokenPayload.account_id ?? null,
      });

      if (authConfig.portalBaseUrl) {
        return res.redirect(`${authConfig.portalBaseUrl}/dashboard?monday=connected`);
      }

      return res.json({
        connected: true,
        tenant_id: claims.tenant_id,
        account_id: tokenPayload.account_id ?? null,
      });
    }),
  );

  app.get(
    "/boards",
    asyncRoute(async (req, res) => {
      const tenantId = getVerifiedTenantId(req);
      const state = await getPersistedState(tokenStore, tenantId);
      const token = state.tokens?.monday_access_token ?? null;

      if (!token) {
        return res.status(409).json({ error: "Monday OAuth token not configured" });
      }

      let boards;
      try {
        boards = await mondayClient.listBoards(token, {
          tenant_id: tenantId,
        });
      } catch (error) {
        logger.error("crm_adapter_board_fetch_failed", {
          tenant_id: tenantId,
          error: error.message,
        });
        return res
          .status(502)
          .json(buildMondayRequestErrorResponse(error, "Failed to query Monday boards"));
      }

      return res.json({
        boards,
        selected_board: state.board ?? null,
        tenant_id: tenantId,
      });
    }),
  );

  app.get(
    "/owners",
    asyncRoute(async (req, res) => {
      const tenantId = getVerifiedTenantId(req);
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

      logger.info("crm_adapter_owner_fetch_started", {
        tenant_id: tenantId,
        owner_limit: limit,
      });

      let boards;
      try {
        boards = await mondayClient.listBoards(token, {
          tenant_id: tenantId,
        });
      } catch (error) {
        logger.error("crm_adapter_owner_fetch_failed", {
          tenant_id: tenantId,
          stage: "board_lookup",
          error: error.message,
        });
        return res
          .status(502)
          .json(buildMondayRequestErrorResponse(error, "Failed to query Monday boards"));
      }
      const sourceBoard = boards.find(
        (board) => String(board.name).trim() === SOURCE_OWNER_BOARD_NAME,
      );

      if (!sourceBoard) {
        return res.status(404).json({ error: `${SOURCE_OWNER_BOARD_NAME} board not found` });
      }

      let items;
      try {
        items = await mondayClient.listBoardItems({
          token,
          boardId: String(sourceBoard.id),
          limit,
          context: {
            tenant_id: tenantId,
          },
        });
      } catch (error) {
        logger.error("crm_adapter_owner_fetch_failed", {
          tenant_id: tenantId,
          board_id: String(sourceBoard.id),
          stage: "item_fetch",
          error: error.message,
        });
        return res
          .status(502)
          .json(buildMondayRequestErrorResponse(error, "Failed to fetch Monday owner records"));
      }

      let owners;
      try {
        owners = normalizeMondayOwnerRecords({
          boardId: String(sourceBoard.id),
          items,
        });
      } catch (error) {
        logger.error("crm_adapter_owner_fetch_failed", {
          tenant_id: tenantId,
          board_id: String(sourceBoard.id),
          stage: "normalization",
          error: error.message,
        });
        return res.status(502).json({
          error: "Failed to normalize Monday owner records",
          details: error.message,
        });
      }

      logger.info("crm_adapter_owner_fetch_completed", {
        tenant_id: tenantId,
        board_id: String(sourceBoard.id),
        owner_count: owners.length,
      });

      return res.json({
        tenant_id: tenantId,
        source_board: {
          id: String(sourceBoard.id),
          name: sourceBoard.name,
        },
        owner_count: owners.length,
        owners,
      });
    }),
  );

  app.post(
    "/boards/select",
    asyncRoute(async (req, res) => {
      const tenantId = getVerifiedTenantId(req);
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
        boards = await mondayClient.listBoards(token, {
          tenant_id: tenantId,
        });
      } catch (error) {
        return res
          .status(502)
          .json(buildMondayRequestErrorResponse(error, "Failed to query Monday boards"));
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

      return res.json({
        selected_board: persistedState.board,
        tenant_id: tenantId,
      });
    }),
  );

  app.get(
    "/mapping",
    asyncRoute(async (req, res) => {
      const tenantId = getVerifiedTenantId(req);
      const state = await getPersistedState(tokenStore, tenantId);

      if (!state.board?.id) {
        return res.status(409).json({ error: "Monday board not selected" });
      }

      return res.json({
        tenant_id: tenantId,
        board_id: state.board.id,
        mapping: state.board_mapping ?? createDefaultMapping(),
      });
    }),
  );

  app.put(
    "/mapping",
    asyncRoute(async (req, res) => {
      const tenantId = getVerifiedTenantId(req);
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
    }),
  );

  app.get(
    "/deliveries",
    asyncRoute(async (req, res) => {
      const tenantId = getVerifiedTenantId(req);
      const state = await getPersistedState(tokenStore, tenantId);

      return res.json({
        tenant_id: tenantId,
        board_id: state.board?.id ?? null,
        deliveries: state.deliveries ?? [],
        scan_runs: state.scan_runs ?? [],
      });
    }),
  );

  app.get(
    "/status",
    asyncRoute(async (req, res) => {
      const tenantId = getVerifiedTenantId(req);
      const state = await getPersistedState(tokenStore, tenantId);

      return res.json(createStatusSnapshot(state, tenantId));
    }),
  );

  app.post(
    "/leads",
    asyncRoute(async (req, res) => {
      const tenantId = getVerifiedTenantId(req);
      const deliveryResult = await deliverLead(tenantId, req.body);
      return res.status(deliveryResult.statusCode).json(deliveryResult.body);
    }),
  );

  app.use((error, req, res, _next) => {
    if (error instanceof TokenStoreError) {
      logger.error("crm_adapter_state_request_failed", {
        tenant_id: req.auth?.tenant_id ?? null,
        scan_id: req.body?.scan_id ?? null,
        path: req.path,
        code: error.code,
        state_path: error.statePath,
        quarantine_path: error.quarantinePath,
        error: error.message,
      });
      return res.status(500).json(buildStateErrorResponse(error));
    }

    logger.error("crm_adapter_request_failed", {
      tenant_id: req.auth?.tenant_id ?? null,
      scan_id: req.body?.scan_id ?? null,
      path: req.path,
      error: error.message,
    });
    return res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

module.exports = {
  SOURCE_OWNER_BOARD_NAME,
  createApp,
  getPersistedState,
};
