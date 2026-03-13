const fs = require("fs");
const fsPromises = require("fs/promises");
const os = require("os");
const path = require("path");

const {
  DEFAULT_STATE_PATH,
  DEFAULT_TENANT_ID,
  FileTokenStore,
  TokenStoreCorruptionError,
} = require("../src/tokenStore");

describe("FileTokenStore", () => {
  it("persists tokens and board state to disk", async () => {
    const filePath = path.join(os.tmpdir(), `lli-saas-state-${Date.now()}.json`);
    const store = new FileTokenStore({ filePath });

    await store.save("monday_access_token", "token-123");
    await store.saveState({
      board: {
        id: "board-1",
        name: "Leads",
      },
    });

    const persisted = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    expect(persisted.tokens.monday_access_token).toBe("token-123");
    expect(persisted.board).toEqual({
      id: "board-1",
      name: "Leads",
    });
    await expect(store.get("monday_access_token")).resolves.toBe("token-123");
  });

  it("persists tenant-aware mapping and delivery state", async () => {
    const filePath = path.join(os.tmpdir(), `lli-saas-tenant-state-${Date.now()}.json`);
    const store = new FileTokenStore({ filePath });

    await store.saveTenantState(DEFAULT_TENANT_ID, {
      board_mapping: {
        item_name_strategy: "deceased_name_only",
        columns: {
          deceased_name: "name",
          owner_name: "owner_column",
        },
      },
      scan_runs: [{ scan_id: "scan-1", status: "completed" }],
      deliveries: [{ delivery_id: "delivery-1", status: "created" }],
    });

    const state = await store.getState();
    const tenantState = await store.getTenantState(DEFAULT_TENANT_ID);

    expect(state.active_tenant_id).toBe(DEFAULT_TENANT_ID);
    expect(tenantState.board_mapping).toEqual({
      item_name_strategy: "deceased_name_only",
      columns: {
        deceased_name: "name",
        owner_name: "owner_column",
      },
    });
    expect(tenantState.scan_runs).toEqual([{ scan_id: "scan-1", status: "completed" }]);
    expect(tenantState.deliveries).toEqual([{ delivery_id: "delivery-1", status: "created" }]);
    expect(tenantState.idempotency_index).toEqual({});
  });

  it("uses CRM_ADAPTER_STATE_PATH when no explicit file path is provided", () => {
    process.env.CRM_ADAPTER_STATE_PATH = "/tmp/lli-saas-crm-adapter-state.json";

    const store = new FileTokenStore();

    expect(store.filePath).toBe("/tmp/lli-saas-crm-adapter-state.json");

    delete process.env.CRM_ADAPTER_STATE_PATH;
    expect(DEFAULT_STATE_PATH).toBe("/var/lib/lli-saas/crm-adapter/monday-state.json");
  });

  it("fails loudly and quarantines corrupt state files", async () => {
    const filePath = path.join(os.tmpdir(), `lli-saas-corrupt-${Date.now()}.json`);
    fs.writeFileSync(filePath, "{not-json", "utf-8");
    const store = new FileTokenStore({ filePath });

    await expect(store.getState()).rejects.toBeInstanceOf(TokenStoreCorruptionError);

    const quarantineFiles = fs
      .readdirSync(path.dirname(filePath))
      .filter((entry) => entry.startsWith(path.basename(filePath) + ".corrupt-"));

    expect(quarantineFiles.length).toBeGreaterThan(0);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("{not-json");
  });

  it("preserves the original state document when an atomic rename fails", async () => {
    const filePath = path.join(os.tmpdir(), `lli-saas-atomic-${Date.now()}.json`);
    const store = new FileTokenStore({ filePath });
    await store.saveState({
      tokens: {
        monday_access_token: "token-123",
      },
    });

    const renameSpy = vi.spyOn(fsPromises, "rename").mockRejectedValueOnce(new Error("disk full"));

    await expect(
      store.saveState({
        board: {
          id: "board-1",
          name: "Leads",
        },
      }),
    ).rejects.toThrow("disk full");

    renameSpy.mockRestore();

    const persisted = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(persisted.tokens.monday_access_token).toBe("token-123");
    expect(persisted.board).toBeNull();

    const tempFiles = fs
      .readdirSync(path.dirname(filePath))
      .filter((entry) => entry.startsWith(path.basename(filePath) + ".tmp-"));
    expect(tempFiles).toEqual([]);
  });

  it("serializes concurrent writes so state updates are not lost", async () => {
    const filePath = path.join(os.tmpdir(), `lli-saas-concurrent-${Date.now()}.json`);
    const storeA = new FileTokenStore({ filePath });
    const storeB = new FileTokenStore({ filePath });

    await Promise.all([
      storeA.saveState({
        tokens: {
          monday_access_token: "token-123",
        },
      }),
      storeB.saveTenantState(DEFAULT_TENANT_ID, {
        deliveries: [{ id: "delivery-1", status: "created" }],
      }),
    ]);

    const persisted = await storeA.getState();
    const tenantState = await storeA.getTenantState(DEFAULT_TENANT_ID);

    expect(persisted.tokens.monday_access_token).toBe("token-123");
    expect(tenantState.deliveries).toEqual([{ id: "delivery-1", status: "created" }]);
  });
});
