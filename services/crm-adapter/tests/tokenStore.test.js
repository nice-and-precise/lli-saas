const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createDefaultMapping,
  DEFAULT_STATE_PATH,
  DEFAULT_TENANT_ID,
  FileTokenStore,
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
      oauth: {
        access_token: "token-123",
        refresh_token: "refresh-123",
        account_id: "acct-1",
      },
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
    expect(state.tokens.monday_refresh_token).toBe("refresh-123");
    expect(tenantState.oauth.refresh_token).toBe("refresh-123");
    expect(tenantState.board_mapping).toEqual({
      item_name_strategy: "deceased_name_only",
      columns: {
        deceased_name: "name",
        owner_name: "owner_column",
      },
    });
    expect(tenantState.scan_runs).toEqual([{ scan_id: "scan-1", status: "completed" }]);
    expect(tenantState.deliveries).toEqual([{ delivery_id: "delivery-1", status: "created" }]);
  });

  it("uses CRM_ADAPTER_STATE_PATH when no explicit file path is provided", () => {
    process.env.CRM_ADAPTER_STATE_PATH = "/tmp/lli-saas-crm-adapter-state.json";

    const store = new FileTokenStore();

    expect(store.filePath).toBe("/tmp/lli-saas-crm-adapter-state.json");

    delete process.env.CRM_ADAPTER_STATE_PATH;
    expect(DEFAULT_STATE_PATH).toBe("/var/lib/lli-saas/crm-adapter/monday-state.json");
  });
});
