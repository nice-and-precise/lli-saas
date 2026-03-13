const fs = require("fs/promises");
const path = require("path");

const { createLogger } = require("./logger");

const DEFAULT_TENANT_ID = "pilot";
const DEFAULT_STATE_PATH = "/var/lib/lli-saas/crm-adapter/monday-state.json";
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_LOCK_RETRY_MS = 25;
const DEFAULT_LOCK_STALE_MS = 30000;

class TokenStoreError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = details.code ?? "token_store_error";
    this.statePath = details.statePath ?? null;
    this.quarantinePath = details.quarantinePath ?? null;
    this.cause = details.cause;
  }
}

class TokenStoreCorruptionError extends TokenStoreError {
  constructor(message, details = {}) {
    super(message, {
      ...details,
      code: "state_corruption",
    });
  }
}

class TokenStoreLockError extends TokenStoreError {
  constructor(message, details = {}) {
    super(message, {
      ...details,
      code: "state_lock_timeout",
    });
  }
}

function createDefaultMapping() {
  return {
    item_name_strategy: "deceased_name_county",
    columns: {},
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
    idempotency_index: {},
    ...overrides,
  };
}

function assertPlainObject(value, fieldPath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldPath} must be an object`);
  }
}

function assertOptionalString(value, fieldPath) {
  if (value != null && typeof value !== "string") {
    throw new Error(`${fieldPath} must be a string or null`);
  }
}

function assertOptionalArray(value, fieldPath) {
  if (value != null && !Array.isArray(value)) {
    throw new Error(`${fieldPath} must be an array`);
  }
}

function validateBoardShape(board, fieldPath) {
  if (board == null) {
    return;
  }

  assertPlainObject(board, fieldPath);
  assertOptionalString(board.id, `${fieldPath}.id`);
  assertOptionalString(board.name, `${fieldPath}.name`);
  assertOptionalArray(board.columns, `${fieldPath}.columns`);
}

function validateMappingShape(mapping, fieldPath) {
  if (mapping == null) {
    return;
  }

  assertPlainObject(mapping, fieldPath);
  assertOptionalString(mapping.item_name_strategy, `${fieldPath}.item_name_strategy`);
  if (mapping.columns != null) {
    assertPlainObject(mapping.columns, `${fieldPath}.columns`);
    Object.entries(mapping.columns).forEach(([key, value]) => {
      assertOptionalString(key, `${fieldPath}.columns.key`);
      assertOptionalString(value, `${fieldPath}.columns.${key}`);
    });
  }
}

function validateIdempotencyIndexShape(index, fieldPath) {
  if (index == null) {
    return;
  }

  assertPlainObject(index, fieldPath);
  Object.entries(index).forEach(([idempotencyKey, value]) => {
    assertOptionalString(idempotencyKey, `${fieldPath}.key`);
    assertPlainObject(value, `${fieldPath}.${idempotencyKey}`);
    assertOptionalString(value.delivery_id, `${fieldPath}.${idempotencyKey}.delivery_id`);
    assertOptionalString(value.item_id, `${fieldPath}.${idempotencyKey}.item_id`);
    assertOptionalString(value.status, `${fieldPath}.${idempotencyKey}.status`);
    assertOptionalString(value.item_name, `${fieldPath}.${idempotencyKey}.item_name`);
    assertOptionalString(value.scan_id, `${fieldPath}.${idempotencyKey}.scan_id`);
    assertOptionalString(value.obituary_url, `${fieldPath}.${idempotencyKey}.obituary_url`);
    assertOptionalString(
      value.fallback_duplicate_key,
      `${fieldPath}.${idempotencyKey}.fallback_duplicate_key`,
    );
    assertOptionalString(value.last_seen_at, `${fieldPath}.${idempotencyKey}.last_seen_at`);
    assertOptionalString(value.first_seen_at, `${fieldPath}.${idempotencyKey}.first_seen_at`);
  });
}

function validateTenantStateShape(tenantState, fieldPath) {
  assertPlainObject(tenantState, fieldPath);
  assertOptionalString(tenantState.tenant_id, `${fieldPath}.tenant_id`);

  if (tenantState.oauth != null) {
    assertPlainObject(tenantState.oauth, `${fieldPath}.oauth`);
    assertOptionalString(tenantState.oauth.access_token, `${fieldPath}.oauth.access_token`);
    assertOptionalString(tenantState.oauth.account_id, `${fieldPath}.oauth.account_id`);
  }

  validateBoardShape(tenantState.selected_board, `${fieldPath}.selected_board`);
  validateMappingShape(tenantState.board_mapping, `${fieldPath}.board_mapping`);
  assertOptionalArray(tenantState.scan_runs, `${fieldPath}.scan_runs`);
  assertOptionalArray(tenantState.deliveries, `${fieldPath}.deliveries`);
  validateIdempotencyIndexShape(tenantState.idempotency_index, `${fieldPath}.idempotency_index`);
}

function validateStateShape(rawState = {}) {
  assertPlainObject(rawState, "state");
  assertOptionalString(rawState.active_tenant_id, "state.active_tenant_id");
  assertOptionalString(rawState.account_id, "state.account_id");
  assertOptionalString(rawState.updated_at, "state.updated_at");

  if (rawState.tokens != null) {
    assertPlainObject(rawState.tokens, "state.tokens");
    Object.entries(rawState.tokens).forEach(([key, value]) => {
      assertOptionalString(value, `state.tokens.${key}`);
    });
  }

  validateBoardShape(rawState.board, "state.board");
  validateMappingShape(rawState.board_mapping, "state.board_mapping");
  assertOptionalArray(rawState.scan_runs, "state.scan_runs");
  assertOptionalArray(rawState.deliveries, "state.deliveries");

  if (rawState.tenants != null) {
    assertPlainObject(rawState.tenants, "state.tenants");
    Object.entries(rawState.tenants).forEach(([tenantId, tenantState]) => {
      validateTenantStateShape(tenantState, `state.tenants.${tenantId}`);
    });
  }
}

function normalizeIdempotencyIndex(index = {}) {
  return Object.fromEntries(
    Object.entries(index ?? {}).map(([key, value]) => [
      key,
      {
        delivery_id: value.delivery_id ?? null,
        item_id: value.item_id ?? null,
        status: value.status ?? null,
        item_name: value.item_name ?? null,
        scan_id: value.scan_id ?? null,
        obituary_url: value.obituary_url ?? null,
        fallback_duplicate_key: value.fallback_duplicate_key ?? null,
        first_seen_at: value.first_seen_at ?? null,
        last_seen_at: value.last_seen_at ?? null,
      },
    ]),
  );
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
    idempotency_index: normalizeIdempotencyIndex(tenantState.idempotency_index),
  };
}

function normalizeState(rawState = {}) {
  validateStateShape(rawState);

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
    Object.entries(rawState.tenants ?? {}).map(([key, value]) => [
      key,
      normalizeTenantState(value),
    ]),
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
      existingTenants[tenantId]?.board_mapping ??
      legacyTenant.board_mapping ??
      createDefaultMapping(),
    account_id:
      existingTenants[tenantId]?.oauth?.account_id ?? legacyTenant.oauth.account_id ?? null,
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
              ...createDefaultMapping(),
              ...partialTenantState.board_mapping,
              columns: {
                ...(partialTenantState.board_mapping.columns ?? {}),
              },
            }
          : currentTenantState.board_mapping,
    scan_runs: partialTenantState.scan_runs ?? currentTenantState.scan_runs,
    deliveries: partialTenantState.deliveries ?? currentTenantState.deliveries,
    idempotency_index: partialTenantState.idempotency_index ?? currentTenantState.idempotency_index,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MemoryTokenStore {
  constructor(options = {}) {
    this.tokens = new Map();
    this.state = normalizeState();
    this.logger = options.logger ?? createLogger("crm-adapter");
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
    const tenantId =
      partialState.active_tenant_id ?? this.state.active_tenant_id ?? DEFAULT_TENANT_ID;
    const currentTenantState =
      this.state.tenants[tenantId] ?? createDefaultTenantState({ tenant_id: tenantId });
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
      idempotency_index: partialState.idempotency_index,
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

  async updateTenantState(tenantId, updateFn) {
    const currentTenantState = await this.getTenantState(tenantId);
    const nextTenantState = await updateFn(structuredClone(currentTenantState));
    return this.saveTenantState(tenantId, nextTenantState);
  }

  async getState() {
    return {
      tokens: { ...this.state.tokens },
      board: this.state.board ? structuredClone(this.state.board) : null,
      account_id: this.state.account_id,
      board_mapping: structuredClone(this.state.board_mapping),
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
    this.filePath = options.filePath ?? process.env.CRM_ADAPTER_STATE_PATH ?? DEFAULT_STATE_PATH;
    this.lockPath = `${this.filePath}.lock`;
    this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    this.lockRetryMs = options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS;
    this.lockStaleMs = options.lockStaleMs ?? DEFAULT_LOCK_STALE_MS;
    this.logger = options.logger ?? createLogger("crm-adapter");
  }

  async save(key, token) {
    await this.#withLockedState(async (state) => {
      state.tokens[key] = token;
      return state;
    });
    return token;
  }

  async get(key) {
    const state = await this.getState();
    return state.tokens[key] ?? null;
  }

  async saveState(partialState) {
    return this.#withLockedState(async (state) => {
      const tenantId = partialState.active_tenant_id ?? state.active_tenant_id ?? DEFAULT_TENANT_ID;
      const currentTenantState =
        state.tenants[tenantId] ?? createDefaultTenantState({ tenant_id: tenantId });
      const mergedTenantState = mergeTenantState(currentTenantState, {
        oauth: {
          access_token:
            partialState.tokens?.monday_access_token ??
            partialState.oauth?.access_token ??
            undefined,
          account_id: partialState.account_id ?? partialState.oauth?.account_id ?? undefined,
        },
        selected_board: partialState.board ?? partialState.selected_board,
        board_mapping: partialState.board_mapping,
        scan_runs: partialState.scan_runs,
        deliveries: partialState.deliveries,
        idempotency_index: partialState.idempotency_index,
      });

      return normalizeState({
        ...state,
        ...partialState,
        active_tenant_id: tenantId,
        tenants: {
          ...state.tenants,
          [tenantId]: mergedTenantState,
        },
        updated_at: new Date().toISOString(),
      });
    });
  }

  async updateTenantState(tenantId, updateFn) {
    return this.#withLockedState(async (state) => {
      const currentTenantState =
        state.tenants[tenantId] ?? createDefaultTenantState({ tenant_id: tenantId });
      const nextTenantState = await updateFn(structuredClone(currentTenantState));

      return normalizeState({
        ...state,
        active_tenant_id: tenantId,
        tenants: {
          ...state.tenants,
          [tenantId]: mergeTenantState(currentTenantState, nextTenantState),
        },
        updated_at: new Date().toISOString(),
      });
    });
  }

  async getState() {
    const state = await this.#readState();
    return {
      tokens: { ...state.tokens },
      board: state.board ? structuredClone(state.board) : null,
      account_id: state.account_id,
      board_mapping: structuredClone(state.board_mapping),
      active_tenant_id: state.active_tenant_id,
      tenants: structuredClone(state.tenants),
      scan_runs: [...state.scan_runs],
      deliveries: [...state.deliveries],
      updated_at: state.updated_at,
    };
  }

  async getTenantState(tenantId = DEFAULT_TENANT_ID) {
    const state = await this.#readState();
    return structuredClone(
      state.tenants[tenantId] ?? createDefaultTenantState({ tenant_id: tenantId }),
    );
  }

  async saveTenantState(tenantId, partialTenantState) {
    return this.saveState({
      active_tenant_id: tenantId,
      ...partialTenantState,
    });
  }

  async #readState() {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      const state = normalizeState(parsed);
      this.logger.info("crm_adapter_state_load_succeeded", {
        state_path: this.filePath,
        tenant_count: Object.keys(state.tenants).length,
      });
      return state;
    } catch (error) {
      if (error.code === "ENOENT") {
        this.logger.info("crm_adapter_state_load_succeeded", {
          state_path: this.filePath,
          tenant_count: 1,
          default_state: true,
        });
        return normalizeState();
      }

      if (error instanceof SyntaxError || error.message?.startsWith("state.")) {
        throw await this.#handleCorruptState(error);
      }

      this.logger.error("crm_adapter_state_load_failed", {
        state_path: this.filePath,
        error: error.message,
      });
      throw error;
    }
  }

  async #handleCorruptState(error) {
    const quarantinePath = `${this.filePath}.corrupt-${Date.now()}`;

    try {
      await fs.mkdir(path.dirname(quarantinePath), { recursive: true });
      await fs.copyFile(this.filePath, quarantinePath);
    } catch (copyError) {
      this.logger.error("crm_adapter_state_quarantine_failed", {
        state_path: this.filePath,
        quarantine_path: quarantinePath,
        error: copyError.message,
      });
    }

    const corruptionError = new TokenStoreCorruptionError(
      `CRM adapter state is corrupt at ${this.filePath}. Restore the file from backup or replace it with a valid state document.`,
      {
        statePath: this.filePath,
        quarantinePath,
        cause: error,
      },
    );

    this.logger.error("crm_adapter_state_corruption_detected", {
      state_path: this.filePath,
      quarantine_path: quarantinePath,
      error: error.message,
    });
    return corruptionError;
  }

  async #withLockedState(updateFn) {
    const releaseLock = await this.#acquireLock();

    try {
      const currentState = await this.#readState();
      const nextState = normalizeState(await updateFn(currentState));
      await this.#writeState(nextState);
      return nextState;
    } finally {
      await releaseLock();
    }
  }

  async #acquireLock() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const startedAt = Date.now();

    while (Date.now() - startedAt < this.lockTimeoutMs) {
      try {
        const handle = await fs.open(this.lockPath, "wx");
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, locked_at: new Date().toISOString() }),
          "utf-8",
        );
        return async () => {
          try {
            await handle.close();
          } finally {
            await fs.unlink(this.lockPath).catch((error) => {
              if (error.code !== "ENOENT") {
                this.logger.warn("crm_adapter_state_lock_release_failed", {
                  lock_path: this.lockPath,
                  error: error.message,
                });
              }
            });
          }
        };
      } catch (error) {
        if (error.code !== "EEXIST") {
          throw error;
        }

        try {
          const stats = await fs.stat(this.lockPath);
          if (Date.now() - stats.mtimeMs > this.lockStaleMs) {
            await fs.unlink(this.lockPath);
            this.logger.warn("crm_adapter_state_lock_stale_reaped", {
              lock_path: this.lockPath,
            });
            continue;
          }
        } catch (statError) {
          if (statError.code !== "ENOENT") {
            throw statError;
          }
        }

        await sleep(this.lockRetryMs);
      }
    }

    const lockError = new TokenStoreLockError(
      `Timed out waiting for CRM adapter state lock at ${this.lockPath}`,
      {
        statePath: this.filePath,
      },
    );
    this.logger.error("crm_adapter_state_lock_failed", {
      state_path: this.filePath,
      lock_path: this.lockPath,
      error: lockError.message,
    });
    throw lockError;
  }

  async #writeState(state) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    let handle;

    try {
      handle = await fs.open(tempPath, "w", 0o600);
      await handle.writeFile(JSON.stringify(state, null, 2), "utf-8");
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(tempPath, this.filePath);
      await this.#syncDirectory(path.dirname(this.filePath));
      this.logger.info("crm_adapter_state_write_succeeded", {
        state_path: this.filePath,
        tenant_count: Object.keys(state.tenants).length,
      });
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
      }
      await fs.unlink(tempPath).catch(() => {});
      this.logger.error("crm_adapter_state_write_failed", {
        state_path: this.filePath,
        error: error.message,
      });
      throw error;
    }
  }

  async #syncDirectory(directoryPath) {
    let handle;

    try {
      handle = await fs.open(directoryPath, "r");
      await handle.sync();
    } catch (error) {
      if (!["EINVAL", "EPERM", "EISDIR"].includes(error.code)) {
        throw error;
      }
    } finally {
      if (handle) {
        await handle.close().catch(() => {});
      }
    }
  }
}

module.exports = {
  DEFAULT_STATE_PATH,
  DEFAULT_TENANT_ID,
  FileTokenStore,
  MemoryTokenStore,
  TokenStoreCorruptionError,
  TokenStoreError,
  TokenStoreLockError,
  createDefaultMapping,
};
