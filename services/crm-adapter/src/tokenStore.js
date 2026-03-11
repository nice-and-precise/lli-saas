const fs = require("fs/promises");
const path = require("path");

const DEFAULT_TENANT_ID = "pilot";

function createDefaultMapping() {
  return {
    item_name_strategy: "deceased_name_address",
    columns: {
      deceased_name: "name",
      owner_name: "text",
      property_address: "text",
      contact_count: "numbers",
      tags: "text",
    },
  };
}

function createDefaultTenantState(overrides = {}) {
  return {
    tenant_id: DEFAULT_TENANT_ID,
    oauth: {
      access_token: null,
      account_id: null,
    },
    selected_board: null,
    board_mapping: createDefaultMapping(),
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
    selected_board: tenantState.selected_board ?? null,
    board_mapping: tenantState.board_mapping ?? createDefaultMapping(),
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
    selected_board: rawState.board ?? null,
    board_mapping: rawState.board_mapping ?? createDefaultMapping(),
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
    board_mapping:
      partialTenantState.board_mapping === null
        ? createDefaultMapping()
        : partialTenantState.board_mapping
          ? {
              ...currentTenantState.board_mapping,
              ...partialTenantState.board_mapping,
              columns: {
                ...currentTenantState.board_mapping.columns,
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
      selected_board: partialState.board ?? partialState.selected_board,
      board_mapping: partialState.board_mapping,
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
      account_id: this.state.account_id,
      board_mapping: this.state.board_mapping,
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

class FileTokenStore {
  constructor(options = {}) {
    this.filePath =
      options.filePath ??
      path.resolve(process.cwd(), "data", "monday-state.json");
  }

  async save(key, token) {
    const state = await this.getState();
    state.tokens[key] = token;
    await this.#writeState(state);
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
      selected_board: partialState.board ?? partialState.selected_board,
      board_mapping: partialState.board_mapping,
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

    await this.#writeState(nextState);
    return nextState;
  }

  async getState() {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return normalizeState(parsed);
    } catch (error) {
      if (error.code === "ENOENT") {
        return normalizeState();
      }

      throw error;
    }
  }

  async #writeState(state) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), "utf-8");
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

module.exports = {
  DEFAULT_TENANT_ID,
  FileTokenStore,
  MemoryTokenStore,
  createDefaultMapping,
};
