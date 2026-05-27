const crypto = require("crypto");
const express = require("express");
const {
  getLeadSchemaPath,
  mapLeadToMondayItemWithMapping,
  validateBoardMapping,
} = require("./leadContract");
const { MondayClient } = require("./mondayClient");
const {
  detectOwnerSourceBoard,
  getOwnerRecordSchemaPath,
  normalizeMondayOwnerRecords,
} = require("./ownerRecord");
const { createProfilingReport } = require("./profiler");
const { createDefaultMapping, DEFAULT_TENANT_ID, createTokenStore } = require("./tokenStore");
const {
  FIELD_METADATA,
  buildValidationResponse,
  normalizeMappingInput,
  validateMondaySetup,
} = require("./validation");

const SOURCE_OWNER_BOARD_NAME = "Clients";
const MAX_IMPORT_OWNERS = 5000;

// The auto-created destination board for delivered leads.
const DESTINATION_BOARD_NAME = "Land Legacy Leads";

// Map an LLI field's preferred type (FIELD_METADATA.recommendedTypes[0]) to a
// creatable Monday ColumnType. "name" is Monday's special default item-name column
// (one per board, not creatable) → fall back to "text"; the rest are identity.
const RECOMMENDED_TYPE_TO_MONDAY_COLUMN = {
  name: "text",
  text: "text",
  long_text: "long_text",
  numbers: "numbers",
  date: "date",
  link: "link",
  checkbox: "checkbox",
  status: "status",
  dropdown: "dropdown",
};

function buildDuplicateKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

// Build a delivery record for a lead that already exists on the board (an
// idempotent retry or a duplicate), persist it, and return the 200 response the
// three "skipped" branches of deliverLead share. Only the status/item_id/
// duplicate_of differ between those branches, so they're passed in.
async function recordSkippedDelivery({ tokenStore, state, tenantId, transactionId, mappedLead, identity, duplicateKey, status, itemId, duplicateOf }) {
  const deliveryRecord = buildDeliveryRecord({
    tenantId,
    transactionId,
    boardId: state.board.id,
    lead: mappedLead.summary,
    itemName: mappedLead.itemName,
    duplicateKey,
    obituaryUrl: mappedLead.summary.obituary_url ?? null,
    fallbackDuplicateKey: identity.fallbackKey,
    status,
    itemId,
    duplicateOf,
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

const REQUIRED_LLI_FIELDS = ["deceased_name", "owner_name", "obituary_url", "match_score", "tier"];

// Field catalog shown by the mapping editor: the board's CRM columns plus the
// LLI owner-data contract fields, annotated with the column each is mapped to.
// Shared by GET and PUT /mapping so the two responses can never drift.
function buildFieldCatalog(state) {
  return {
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
      required: REQUIRED_LLI_FIELDS.includes(key),
      mapped_column_id: state.board_mapping?.columns?.[key] ?? null,
    })),
  };
}

function createStatusSnapshot(state, tenantId) {
  return {
    tenant_id: tenantId,
    board: state.board ?? null,
    source_board: state.source_board ?? null,
    board_mapping: state.board_mapping ?? createDefaultMapping(),
    // Lets the portal decide, from one /status read, whether to run auto-onboarding
    // (connected but not yet provisioned) without firing a write endpoint blindly.
    token_present: Boolean(state.tokens?.monday_access_token),
    onboarding: state.onboarding ?? { auto_provisioned_at: null },
    deliveries: state.deliveries ?? [],
    scan_runs: state.scan_runs ?? [],
    latest_delivery: state.deliveries?.[0] ?? null,
  };
}

function createRuntimeVisibility({ tokenStore, mondayConfig }) {
  return {
    monday_oauth_configured: Object.values(mondayConfig).every(Boolean),
    source_owner_board_name: SOURCE_OWNER_BOARD_NAME,
    // Backend name only ("file"/"kv"/"memory") — never the filesystem path.
    token_store: tokenStore.label ?? "memory",
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
      source_board: tenantState.source_board ?? state.source_board ?? null,
      onboarding: tenantState.onboarding ?? state.onboarding ?? { auto_provisioned_at: null },
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

// Env-gated guard for server-to-server endpoints (/owners exposes owner data,
// /leads writes to Monday). When SERVICE_SHARED_SECRET is set (production),
// callers must present a matching bearer token — lead-engine sends it on its
// outbound calls. When unset (local dev/tests), this is a no-op. The OAuth
// callback and portal-facing read endpoints are intentionally not guarded;
// portal access is gated by Vercel Deployment Protection at the platform level.
function requireServiceSecret(req, res, next) {
  const secret = process.env.SERVICE_SHARED_SECRET;
  if (!secret) {
    return next();
  }
  if (req.get("authorization") === `Bearer ${secret}`) {
    return next();
  }
  return res.status(401).json({ error: "unauthorized", message: "missing or invalid service credentials" });
}

function createApp(options = {}) {
  const app = express();
  const tokenStore = options.tokenStore ?? createTokenStore();
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

  // CORS: the operator portal is served from a different subdomain
  // (lli.jordandamhof.com) than this API, so browser fetches are cross-origin.
  // Reflect any *.jordandamhof.com origin (and localhost for dev) and answer
  // preflight requests.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && /^https:\/\/([a-z0-9-]+\.)?jordandamhof\.com$|^http:\/\/localhost:\d+$/.test(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-tenant-id");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
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
      return recordSkippedDelivery({
        tokenStore,
        state,
        tenantId,
        transactionId,
        mappedLead,
        identity,
        duplicateKey,
        status: "skipped_idempotent_retry",
        itemId: persistedTransaction.item_id,
        duplicateOf: persistedTransaction.item_id,
      });
    }

    const persistedDuplicate = findExistingDeliveryByIdentity(state.deliveries, identity);
    if (persistedDuplicate?.item_id) {
      return recordSkippedDelivery({
        tokenStore,
        state,
        tenantId,
        transactionId,
        mappedLead,
        identity,
        duplicateKey,
        status: "skipped_duplicate",
        itemId: persistedDuplicate.item_id ?? null,
        duplicateOf: persistedDuplicate.item_id ?? persistedDuplicate.duplicate_of ?? null,
      });
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
      return recordSkippedDelivery({
        tokenStore,
        state,
        tenantId,
        transactionId,
        mappedLead,
        identity,
        duplicateKey,
        status: "skipped_duplicate",
        itemId: duplicateMatch.id ?? null,
        duplicateOf: duplicateMatch.id ?? null,
      });
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

  app.get("/", (_req, res) => {
    res.json({ service: "crm-adapter", status: "ok", docs: "/health, /ready" });
  });

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

    try {
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
    } catch (error) {
      // Don't leak upstream error/stack on a public endpoint; keep it generic.
      return res.status(400).json({ error: "oauth_exchange_failed" });
    }

    // Return the operator to the portal instead of dead-ending on JSON.
    const portalBaseUrl = (process.env.PORTAL_BASE_URL ?? "https://lli.jordandamhof.com").replace(/\/+$/, "");
    return res.redirect(`${portalBaseUrl}/dashboard?connected=1`);
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

  // Create + populate the owner-source ("Clients") board from a list of owners.
  // Powers white-glove onboarding and the portal CSV upload. Not service-secret
  // guarded — the portal (browser) calls it; access is gated by the OAuth token
  // (only the connected account's boards are touched) and platform protection.
  app.post("/owners/import", async (req, res) => {
    const tenantId = getTenantId(req);
    const owners = Array.isArray(req.body?.owners) ? req.body.owners : [];
    const boardName = String(req.body?.board_name ?? SOURCE_OWNER_BOARD_NAME).trim() || SOURCE_OWNER_BOARD_NAME;
    if (owners.length === 0) {
      return res.status(400).json({ error: "no owners provided" });
    }
    // Bound the request so the endpoint can't be used to flood a Monday workspace.
    if (owners.length > MAX_IMPORT_OWNERS) {
      return res.status(413).json({ error: `too many owners (max ${MAX_IMPORT_OWNERS})` });
    }
    if (boardName.length > 255 || !/^[\w .,'&()/-]+$/.test(boardName)) {
      return res.status(400).json({ error: "invalid board_name" });
    }

    const state = await getPersistedState(tokenStore, tenantId);
    const token = state.tokens?.monday_access_token ?? null;
    if (!token) {
      return res.status(409).json({ error: "Monday OAuth token not configured" });
    }

    try {
      const findBoard = async () =>
        (await mondayClient.listBoards(token)).find((board) => String(board.name).trim() === boardName);

      let board = await findBoard();
      if (!board) {
        await mondayClient.createBoard({ token, boardName });
        board = await findBoard();
      }
      const boardId = String(board.id);

      // Ensure County + State text columns; map lowercased title -> column id.
      const columnIdByTitle = {};
      for (const column of board.columns ?? []) {
        columnIdByTitle[String(column.title).toLowerCase()] = column.id;
      }
      const ensureColumn = async (title) => {
        const key = title.toLowerCase();
        if (columnIdByTitle[key]) return columnIdByTitle[key];
        const created = await mondayClient.createColumn({ token, boardId, title });
        columnIdByTitle[key] = created.id;
        return created.id;
      };
      const countyColumnId = await ensureColumn("County");
      const stateColumnId = await ensureColumn("State");

      let ownersCreated = 0;
      for (const owner of owners) {
        const itemName = String(owner.owner_name ?? owner.name ?? "").trim();
        if (!itemName) continue;
        const columnValues = {};
        if (owner.county) columnValues[countyColumnId] = String(owner.county);
        if (owner.state) columnValues[stateColumnId] = String(owner.state);
        await mondayClient.createItem({ token, boardId, itemName, columnValues });
        ownersCreated += 1;
      }

      return res.status(201).json({ board_id: boardId, board_name: boardName, owners_created: ownersCreated });
    } catch (error) {
      return res.status(502).json(buildMondayRequestErrorResponse(error, "Failed to import owners into Monday"));
    }
  });

  app.get("/owners", requireServiceSecret, async (req, res) => {
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
    // Prefer the persisted (auto-detected or operator-chosen) source board by id;
    // fall back to the legacy "Clients" name match for back-compat.
    const persistedSourceId = state.source_board?.id ? String(state.source_board.id) : "";
    const sourceBoard =
      (persistedSourceId && boards.find((board) => String(board.id) === persistedSourceId)) ||
      boards.find((board) => String(board.name).trim() === SOURCE_OWNER_BOARD_NAME) ||
      null;

    if (!sourceBoard) {
      return res.status(404).json({
        error: "No owner source board is configured or found",
        details: `Set a source board (or create a "${SOURCE_OWNER_BOARD_NAME}" board).`,
      });
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

  // Operator override for the auto-detected owner SOURCE board (the input board the
  // scan reads landowners from). Mirrors /boards/select but persists `source_board`.
  app.post("/boards/select-source", async (req, res) => {
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
    const sourceBoard = boards.find((board) => String(board.id) === boardId);

    if (!sourceBoard) {
      return res.status(404).json({ error: "Board not found" });
    }

    const persistedState = await tokenStore.saveTenantState(tenantId, {
      source_board: {
        id: String(sourceBoard.id),
        name: sourceBoard.name,
      },
    });
    const validation = await getValidationSnapshot(tenantId, { state: persistedState });

    return res.json({
      source_board: persistedState.source_board,
      tenant_id: tenantId,
      validation,
    });
  });

  // Find-or-create the "Land Legacy Leads" destination board with one correctly-typed
  // column per LLI field, and build the field→column mapping directly (no guessing).
  // Idempotent: re-running finds the existing board + columns by name and produces the
  // same mapping. Returns the persisted board (with column types, needed by delivery),
  // the mapping, and a fresh validation snapshot.
  async function provisionDestinationBoard(tenantId, token) {
    const listBoards = async () => mondayClient.listBoards(token);
    const findBoard = (boards) =>
      (boards ?? []).find((board) => String(board.name).trim() === DESTINATION_BOARD_NAME) ?? null;

    let board = findBoard(await listBoards());
    if (!board) {
      await mondayClient.createBoard({ token, boardName: DESTINATION_BOARD_NAME });
      board = findBoard(await listBoards());
    }
    if (!board) {
      throw new Error("Failed to create the destination board");
    }
    const boardId = String(board.id);

    // Find-or-create each column by lowercased title; track {id,title,type} so the
    // delivery path can format values by column type.
    const columnByTitleKey = {};
    const columns = [];
    for (const column of board.columns ?? []) {
      const entry = { id: column.id, title: column.title, type: column.type };
      columnByTitleKey[String(column.title).toLowerCase()] = entry;
      columns.push(entry);
    }
    const ensureColumn = async (title, columnType) => {
      const key = title.toLowerCase();
      if (columnByTitleKey[key]) return columnByTitleKey[key];
      const created = await mondayClient.createColumn({ token, boardId, title, columnType });
      const entry = { id: String(created.id), title, type: columnType };
      columnByTitleKey[key] = entry;
      columns.push(entry);
      return entry;
    };

    const mappingColumns = {};
    for (const [field, metadata] of Object.entries(FIELD_METADATA)) {
      const columnType = RECOMMENDED_TYPE_TO_MONDAY_COLUMN[metadata.recommendedTypes?.[0]] ?? "text";
      const entry = await ensureColumn(metadata.label, columnType);
      mappingColumns[field] = entry.id;
    }
    const mapping = { ...createDefaultMapping(), columns: mappingColumns };
    validateBoardMapping(mapping);

    return tokenStore.saveTenantState(tenantId, {
      board: { id: boardId, name: board.name, columns },
      board_mapping: mapping,
    });
  }

  app.post("/boards/auto-provision-destination", async (req, res) => {
    const tenantId = getTenantId(req);
    const state = await getPersistedState(tokenStore, tenantId);
    const token = state.tokens?.monday_access_token ?? null;

    if (!token) {
      return res.status(409).json({ error: "Monday OAuth token not configured" });
    }

    let persistedState;
    try {
      persistedState = await provisionDestinationBoard(tenantId, token);
    } catch (error) {
      return res.status(502).json(buildMondayRequestErrorResponse(error, "Failed to provision destination board"));
    }
    const validation = await getValidationSnapshot(tenantId, { state: persistedState });

    return res.json({
      board: persistedState.board,
      source_board: persistedState.source_board,
      mapping: persistedState.board_mapping,
      tenant_id: tenantId,
      validation,
    });
  });

  // One-shot auto-onboarding, called by the portal on the first connected dashboard
  // load. Best-effort + idempotent: auto-detect the owner source board AND provision
  // the destination board + mapping, then stamp `auto_provisioned_at` so it never
  // re-runs automatically (the marker, not board presence, is the gate). Each step is
  // contained so a Monday hiccup degrades gracefully instead of breaking the load.
  app.post("/onboard/auto-provision", async (req, res) => {
    const tenantId = getTenantId(req);
    const state = await getPersistedState(tokenStore, tenantId);
    const token = state.tokens?.monday_access_token ?? null;

    if (!token) {
      return res.status(409).json({ error: "Monday OAuth token not configured" });
    }

    // Already attempted → return the stored snapshot WITHOUT touching Monday. The
    // portal makes its own /validation call for the live check.
    if (state.onboarding?.auto_provisioned_at) {
      return res.json({
        already_provisioned: true,
        tenant_id: tenantId,
        onboarding: state.onboarding,
        source_board: state.source_board,
        board: state.board,
        mapping: state.board_mapping,
      });
    }

    let sourceBoardDetected = false;
    try {
      const boards = await mondayClient.listBoards(token);
      const { best } = detectOwnerSourceBoard(boards);
      if (best) {
        await tokenStore.saveTenantState(tenantId, {
          source_board: { id: String(best.id), name: best.name },
        });
        sourceBoardDetected = true;
      }
    } catch (error) {
      // best-effort: leave source_board unset → portal surfaces CSV import as fallback.
      console.error(`[auto-provision] source-board detection failed tenant=${tenantId}: ${error.message}`);
    }

    let destinationProvisioned = false;
    try {
      await provisionDestinationBoard(tenantId, token);
      destinationProvisioned = true;
    } catch (error) {
      // best-effort: leave destination unset. We do NOT stamp the marker below in this
      // case, so the next dashboard load retries (self-healing for transient Monday
      // errors). `/boards/auto-provision-destination` is also the explicit retry.
      console.error(`[auto-provision] destination provisioning failed tenant=${tenantId}: ${error.message}`);
    }

    const persistedState = await tokenStore.saveTenantState(tenantId, {
      onboarding: {
        // Only mark "done" when the destination is built — a failed attempt stays
        // unmarked so a reload retries rather than locking the tenant into a broken state.
        auto_provisioned_at: destinationProvisioned ? new Date().toISOString() : null,
        source_board_detected: sourceBoardDetected,
        destination_provisioned: destinationProvisioned,
      },
    });
    const validation = await getValidationSnapshot(tenantId, { state: persistedState });

    return res.json({
      auto_provisioned: true,
      tenant_id: tenantId,
      onboarding: persistedState.onboarding,
      source_board: persistedState.source_board,
      board: persistedState.board,
      mapping: persistedState.board_mapping,
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
      field_catalog: buildFieldCatalog(state),
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
      field_catalog: buildFieldCatalog(persistedState),
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

  app.post("/owners/profile", async (req, res) => {
    const tenantId = getTenantId(req);
    const payload = req.body ?? {};
    const ownerRecords = Array.isArray(payload.owner_records) ? payload.owner_records : null;

    if (!ownerRecords) {
      return res.status(400).json({ error: "owner_records must be an array" });
    }

    try {
      const report = createProfilingReport(ownerRecords, {
        datasetName: payload.dataset_name ?? `tenant_${tenantId}_owner_data`,
      });

      return res.json({
        tenant_id: tenantId,
        report,
      });
    } catch (error) {
      return res.status(400).json({
        error: "Failed to profile owner records",
        details: error.message,
      });
    }
  });

  app.post("/leads", requireServiceSecret, async (req, res) => {
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
