const fs = require("fs/promises");
const path = require("path");

const DEFAULT_TENANT_ID = "pilot";
const DEFAULT_STATE_PATH = "/var/lib/lli-saas/crm-adapter/monday-state.json";

function createDefaultMapping() {
  return {
    item_name_strategy: "deceased_name_county",
    columns: {},
  };
}

function createDefaultOnboarding() {
  // Explicit "did we attempt auto-configuration for this tenant" marker. The
  // orchestrator (`/onboard/auto-provision`) keys idempotency off `auto_provisioned_at`
  // — NOT off source_board/selected_board being set (those can be non-null from manual
  // setup or history). The boolean outcomes record what the attempt achieved so a
  // partial failure is visible (and re-running `/boards/auto-provision-destination` is
  // the explicit retry).
  return { auto_provisioned_at: null, source_board_detected: false, destination_provisioned: false };
}

function createDefaultTenantState(overrides = {}) {
  return {
    tenant_id: DEFAULT_TENANT_ID,
    oauth: {
      access_token: null,
      account_id: null,
    },
    // The owner-records board (input). Separate from selected_board (the leads
    // destination). Auto-detected on first connect; overridable.
    source_board: null,
    selected_board: null,
    board_mapping: createDefaultMapping(),
    onboarding: createDefaultOnboarding(),
    scan_runs: [],
    deliveries: [],
    ...overrides,
  };
}

function normalizeTenantState(tenantState = {}) {
  return {
    tenant_id: tenantState.tenant_id ?? DEFAULT_TENANT_ID,
    oauth: {
      access_token: tenantState.oauth?.access_token ?? null,
      account_id: tenantState.oauth?.account_id ?? null,
    },
    source_board: tenantState.source_board ?? null,
    selected_board: tenantState.selected_board ?? null,
    board_mapping: tenantState.board_mapping ?? createDefaultMapping(),
    onboarding: {
      auto_provisioned_at: tenantState.onboarding?.auto_provisioned_at ?? null,
      source_board_detected: tenantState.onboarding?.source_board_detected ?? false,
      destination_provisioned: tenantState.onboarding?.destination_provisioned ?? false,
    },
    scan_runs: Array.isArray(tenantState.scan_runs) ? tenantState.scan_runs : [],
    deliveries: Array.isArray(tenantState.deliveries) ? tenantState.deliveries : [],
  };
}

function normalizeState(rawState = {}) {
  const tenantId = rawState.active_tenant_id ?? DEFAULT_TENANT_ID;
  const legacyTenant = normalizeTenantState({
    tenant_id: tenantId,
    oauth: {
      access_token: rawState.tokens?.monday_access_token ?? null,
      account_id: rawState.account_id ?? null,
    },
    source_board: rawState.source_board ?? null,
    selected_board: rawState.board ?? null,
    board_mapping: rawState.board_mapping ?? createDefaultMapping(),
    onboarding: rawState.onboarding ?? createDefaultOnboarding(),
    scan_runs: rawState.scan_runs ?? [],
    deliveries: rawState.deliveries ?? [],
  });
  const existingTenants = Object.fromEntries(
    Object.entries(rawState.tenants ?? {}).map(([key, value]) => [key, normalizeTenantState(value)]),
  );

  return {
    active_tenant_id: tenantId,
    tenants: {
      [tenantId]: existingTenants[tenantId] ?? legacyTenant,
      ...existingTenants,
    },
    tokens: {
      monday_access_token:
        existingTenants[tenantId]?.oauth?.access_token ?? legacyTenant.oauth.access_token ?? null,
    },
    board: existingTenants[tenantId]?.selected_board ?? legacyTenant.selected_board ?? null,
    source_board: existingTenants[tenantId]?.source_board ?? legacyTenant.source_board ?? null,
    onboarding:
      existingTenants[tenantId]?.onboarding ?? legacyTenant.onboarding ?? createDefaultOnboarding(),
    board_mapping:
      existingTenants[tenantId]?.board_mapping ?? legacyTenant.board_mapping ?? createDefaultMapping(),
    account_id: existingTenants[tenantId]?.oauth?.account_id ?? legacyTenant.oauth.account_id ?? null,
    scan_runs: existingTenants[tenantId]?.scan_runs ?? legacyTenant.scan_runs,
    deliveries: existingTenants[tenantId]?.deliveries ?? legacyTenant.deliveries,
    updated_at: rawState.updated_at ?? null,
  };
}

function mergeTenantState(currentTenantState, partialTenantState = {}) {
  return normalizeTenantState({
    ...currentTenantState,
    ...partialTenantState,
    oauth: {
      ...currentTenantState.oauth,
      ...(partialTenantState.oauth ?? {}),
    },
    selected_board:
      partialTenantState.selected_board === null
        ? null
        : partialTenantState.selected_board
          ? {
              ...(currentTenantState.selected_board ?? {}),
              ...partialTenantState.selected_board,
            }
          : currentTenantState.selected_board,
    source_board:
      partialTenantState.source_board === null
        ? null
        : partialTenantState.source_board
          ? {
              ...(currentTenantState.source_board ?? {}),
              ...partialTenantState.source_board,
            }
          : currentTenantState.source_board,
    onboarding: {
      ...(currentTenantState.onboarding ?? createDefaultOnboarding()),
      ...(partialTenantState.onboarding ?? {}),
    },
    board_mapping:
      partialTenantState.board_mapping === null
        ? createDefaultMapping()
        : partialTenantState.board_mapping
          ? {
              ...createDefaultMapping(),
              ...partialTenantState.board_mapping,
              columns: {
                ...(partialTenantState.board_mapping.columns ?? {}),
              },
            }
          : currentTenantState.board_mapping,
    scan_runs: partialTenantState.scan_runs ?? currentTenantState.scan_runs,
    deliveries: partialTenantState.deliveries ?? currentTenantState.deliveries,
  });
}

class MemoryTokenStore {
  constructor() {
    this.label = "memory";
    this.tokens = new Map();
    this.state = normalizeState();
  }

  async save(key, token) {
    this.tokens.set(key, token);
    this.state.tokens[key] = token;
    this.state.updated_at = new Date().toISOString();
    return token;
  }

  async get(key) {
    return this.tokens.get(key) ?? null;
  }

  async saveState(partialState) {
    const tenantId = partialState.active_tenant_id ?? this.state.active_tenant_id ?? DEFAULT_TENANT_ID;
    const currentTenantState = this.state.tenants[tenantId] ?? createDefaultTenantState({ tenant_id: tenantId });
    const mergedTenantState = mergeTenantState(currentTenantState, {
      oauth: {
        access_token:
          partialState.tokens?.monday_access_token ?? partialState.oauth?.access_token ?? undefined,
        account_id: partialState.account_id ?? partialState.oauth?.account_id ?? undefined,
      },
      source_board: partialState.source_board,
      selected_board: partialState.board ?? partialState.selected_board,
      board_mapping: partialState.board_mapping,
      onboarding: partialState.onboarding,
      scan_runs: partialState.scan_runs,
      deliveries: partialState.deliveries,
    });

    this.state = normalizeState({
      ...this.state,
      ...partialState,
      active_tenant_id: tenantId,
      tenants: {
        ...this.state.tenants,
        [tenantId]: mergedTenantState,
      },
      updated_at: new Date().toISOString(),
    });

    Object.entries(this.state.tokens).forEach(([key, value]) => {
      if (value != null) {
        this.tokens.set(key, value);
      }
    });

    return this.state;
  }

  async getState() {
    return {
      tokens: { ...this.state.tokens },
      board: this.state.board ? { ...this.state.board } : null,
      source_board: this.state.source_board ? { ...this.state.source_board } : null,
      account_id: this.state.account_id,
      board_mapping: this.state.board_mapping,
      onboarding: { ...(this.state.onboarding ?? createDefaultOnboarding()) },
      active_tenant_id: this.state.active_tenant_id,
      tenants: structuredClone(this.state.tenants),
      scan_runs: [...this.state.scan_runs],
      deliveries: [...this.state.deliveries],
      updated_at: this.state.updated_at,
    };
  }

  async getTenantState(tenantId = this.state.active_tenant_id ?? DEFAULT_TENANT_ID) {
    return structuredClone(
      this.state.tenants[tenantId] ?? createDefaultTenantState({ tenant_id: tenantId }),
    );
  }

  async saveTenantState(tenantId, partialTenantState) {
    return this.saveState({
      active_tenant_id: tenantId,
      ...partialTenantState,
    });
  }
}

// Shared persistence logic for any durable backend. Subclasses implement only
// the raw read/write primitives (`_readRaw`/`_writeRaw`); everything above —
// token access, tenant merging, normalization — lives here so the file and KV
// adapters can never drift apart.
class PersistentTokenStore {
  async _readRaw() {
    throw new Error("_readRaw not implemented");
  }

  async _writeRaw(_state) {
    throw new Error("_writeRaw not implemented");
  }

  async save(key, token) {
    const state = await this.getState();
    state.tokens[key] = token;
    await this._writeRaw(state);
    return token;
  }

  async get(key) {
    const state = await this.getState();
    return state.tokens[key] ?? null;
  }

  async saveState(partialState) {
    const state = await this.getState();
    const tenantId = partialState.active_tenant_id ?? state.active_tenant_id ?? DEFAULT_TENANT_ID;
    const currentTenantState = state.tenants[tenantId] ?? createDefaultTenantState({ tenant_id: tenantId });
    const mergedTenantState = mergeTenantState(currentTenantState, {
      oauth: {
        access_token:
          partialState.tokens?.monday_access_token ?? partialState.oauth?.access_token ?? undefined,
        account_id: partialState.account_id ?? partialState.oauth?.account_id ?? undefined,
      },
      source_board: partialState.source_board,
      selected_board: partialState.board ?? partialState.selected_board,
      board_mapping: partialState.board_mapping,
      onboarding: partialState.onboarding,
      scan_runs: partialState.scan_runs,
      deliveries: partialState.deliveries,
    });
    const nextState = normalizeState({
      ...state,
      ...partialState,
      active_tenant_id: tenantId,
      tenants: {
        ...state.tenants,
        [tenantId]: mergedTenantState,
      },
      updated_at: new Date().toISOString(),
    });

    await this._writeRaw(nextState);
    return nextState;
  }

  async getState() {
    const raw = await this._readRaw();
    return normalizeState(raw ?? undefined);
  }

  async getTenantState(tenantId = DEFAULT_TENANT_ID) {
    const state = await this.getState();
    return structuredClone(state.tenants[tenantId] ?? createDefaultTenantState({ tenant_id: tenantId }));
  }

  async saveTenantState(tenantId, partialTenantState) {
    return this.saveState({
      active_tenant_id: tenantId,
      ...partialTenantState,
    });
  }
}

class FileTokenStore extends PersistentTokenStore {
  constructor(options = {}) {
    super();
    this.label = "file";
    this.filePath =
      options.filePath ??
      process.env.CRM_ADAPTER_STATE_PATH ??
      DEFAULT_STATE_PATH;
  }

  async _readRaw() {
    try {
      return JSON.parse(await fs.readFile(this.filePath, "utf-8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  async _writeRaw(state) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), "utf-8");
  }
}

// Vercel functions have no persistent filesystem, so production state lives in
// Upstash Redis (provisioned via the Vercel KV marketplace integration, which
// injects KV_REST_API_URL / KV_REST_API_TOKEN). `@upstash/redis` is required
// lazily so the file/memory adapters work without the dependency installed.
class KvTokenStore extends PersistentTokenStore {
  constructor(options = {}) {
    super();
    this.label = "kv";
    this.key = options.key ?? process.env.CRM_ADAPTER_KV_KEY ?? "crm-adapter:state";
    this._client = options.client ?? null;
  }

  _redis() {
    if (!this._client) {
      const { Redis } = require("@upstash/redis");
      // Construct explicitly from the KV_* vars the Vercel/Upstash integration
      // injects (Redis.fromEnv() instead expects UPSTASH_REDIS_REST_* names).
      this._client = new Redis({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
      });
    }
    return this._client;
  }

  async _readRaw() {
    // @upstash/redis auto-deserializes JSON values, returning the object or null.
    return (await this._redis().get(this.key)) ?? null;
  }

  async _writeRaw(state) {
    await this._redis().set(this.key, state);
  }
}

// Selects the backend from STATE_STORE_BACKEND (default "file" so local dev and
// the existing test suite keep working unchanged).
function createTokenStore(options = {}) {
  const backend = (options.backend ?? process.env.STATE_STORE_BACKEND ?? "file").toLowerCase();
  switch (backend) {
    case "kv":
      return new KvTokenStore(options);
    case "memory":
      return new MemoryTokenStore();
    case "file":
    default:
      return new FileTokenStore(options);
  }
}

module.exports = {
  DEFAULT_STATE_PATH,
  DEFAULT_TENANT_ID,
  FileTokenStore,
  KvTokenStore,
  MemoryTokenStore,
  PersistentTokenStore,
  createTokenStore,
  createDefaultMapping,
};
