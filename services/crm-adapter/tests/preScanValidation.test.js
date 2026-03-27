const { buildPreScanValidation } = require("../src/app");
const { MemoryTokenStore } = require("../src/tokenStore");

describe("pre-scan Monday validation", () => {
  it("returns validation details for board, mapping, and token readiness", async () => {
    const tokenStore = new MemoryTokenStore();
    await tokenStore.saveTenantState("pilot", {
      oauth: { access_token: "token-123", account_id: "acct-1" },
      selected_board: {
        id: "board-1",
        name: "Leads",
        columns: [
          { id: "owner_col", title: "Owner Name", type: "text" },
          { id: "obit_col", title: "Obituary URL", type: "link" },
          { id: "tier_col", title: "Tier", type: "status" },
        ],
      },
      board_mapping: {
        item_name_strategy: "deceased_name_county",
        columns: {
          owner_name: "owner_col",
          obituary_url: "obit_col",
          tier: "tier_col",
        },
      },
    });

    const validation = await buildPreScanValidation({
      tokenStore,
      mondayClient: {
        getMe: vi.fn(async () => ({ id: "user-1", name: "Pilot User" })),
        getBoard: vi.fn(async () => ({
          id: "board-1",
          name: "Leads",
          columns: [
            { id: "owner_col", title: "Owner Name", type: "text" },
            { id: "obit_col", title: "Obituary URL", type: "link" },
            { id: "tier_col", title: "Tier", type: "status" },
          ],
        })),
      },
      mondayConfig: {
        MONDAY_CLIENT_ID: "client-id",
        MONDAY_CLIENT_SECRET: "secret",
        MONDAY_REDIRECT_URI: "http://localhost:3000/auth/callback",
      },
      tenantId: "pilot",
    });

    expect(validation.ready).toBe(true);
    expect(validation.token_validation.refresh.status).toBe("not_supported");
    expect(validation.board_validation.ok).toBe(true);
  });

  it("returns ready when token, live board, and required mappings are valid", async () => {
    const tokenStore = new MemoryTokenStore();
    await tokenStore.saveTenantState("pilot", {
      oauth: { access_token: "token-123", account_id: "acct-1" },
      selected_board: {
        id: "board-1",
        name: "Leads",
        columns: [],
      },
      board_mapping: {
        item_name_strategy: "deceased_name_county",
        columns: {
          owner_name: "owner_col",
          obituary_url: "obit_col",
          tier: "tier_col",
        },
      },
    });

    const validation = await buildPreScanValidation({
      tokenStore,
      mondayClient: {
        getMe: vi.fn(async () => ({ id: "user-1", name: "Pilot User", email: "pilot@example.com" })),
        getBoard: vi.fn(async () => ({
          id: "board-1",
          name: "Leads",
          columns: [
            { id: "owner_col", title: "Owner Name", type: "text" },
            { id: "obit_col", title: "Obituary URL", type: "link" },
            { id: "tier_col", title: "Tier", type: "status" },
          ],
        })),
      },
      mondayConfig: {
        MONDAY_CLIENT_ID: "client-id",
        MONDAY_CLIENT_SECRET: "secret",
        MONDAY_REDIRECT_URI: "http://localhost:3000/auth/callback",
      },
      tenantId: "pilot",
    });

    expect(validation.ready).toBe(true);
    expect(validation.token_validation.status).toBe("valid");
    expect(validation.token_validation.refresh.status).toBe("not_supported");
    expect(validation.board_validation.field_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "owner_name", status: "valid" }),
        expect.objectContaining({ field: "obituary_url", status: "valid" }),
        expect.objectContaining({ field: "tier", status: "valid" }),
      ]),
    );
  });

  it("returns actionable issues when required mappings are missing", async () => {
    const tokenStore = new MemoryTokenStore();
    await tokenStore.saveTenantState("pilot", {
      oauth: { access_token: "token-123", account_id: "acct-1" },
      selected_board: {
        id: "board-1",
        name: "Leads",
        columns: [
          { id: "owner_col", title: "Owner Name", type: "text" },
          { id: "obit_col", title: "Obituary URL", type: "link" },
          { id: "tier_col", title: "Tier", type: "status" },
        ],
      },
      board_mapping: {
        item_name_strategy: "deceased_name_county",
        columns: {
          owner_name: "owner_col",
        },
      },
    });

    const validation = await buildPreScanValidation({
      tokenStore,
      mondayClient: {
        getMe: vi.fn(async () => ({ id: "user-1", name: "Pilot User" })),
        getBoard: vi.fn(async () => ({
          id: "board-1",
          name: "Leads",
          columns: [
            { id: "owner_col", title: "Owner Name", type: "text" },
            { id: "obit_col", title: "Obituary URL", type: "link" },
            { id: "tier_col", title: "Tier", type: "status" },
          ],
        })),
      },
      mondayConfig: {
        MONDAY_CLIENT_ID: "client-id",
        MONDAY_CLIENT_SECRET: "secret",
        MONDAY_REDIRECT_URI: "http://localhost:3000/auth/callback",
      },
      tenantId: "pilot",
    });

    expect(validation.ready).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_required_mapping",
          field: "obituary_url",
        }),
        expect.objectContaining({
          code: "missing_required_mapping",
          field: "tier",
        }),
      ]),
    );
  });

  it("returns actionable issues when the live Monday board schema is missing required columns", async () => {
    const tokenStore = new MemoryTokenStore();
    await tokenStore.saveTenantState("pilot", {
      oauth: { access_token: "token-123", account_id: "acct-1" },
      selected_board: {
        id: "board-1",
        name: "Leads",
        columns: [
          { id: "owner_col", title: "Owner Name", type: "text" },
          { id: "obit_col", title: "Obituary URL", type: "link" },
          { id: "tier_col", title: "Tier", type: "status" },
        ],
      },
      board_mapping: {
        item_name_strategy: "deceased_name_county",
        columns: {
          owner_name: "owner_col",
          obituary_url: "obit_col",
          tier: "tier_col",
        },
      },
    });

    const validation = await buildPreScanValidation({
      tokenStore,
      mondayClient: {
        getMe: vi.fn(async () => ({ id: "user-1", name: "Pilot User" })),
        getBoard: vi.fn(async () => ({
          id: "board-1",
          name: "Leads",
          columns: [
            { id: "owner_col", title: "Owner Name", type: "text" },
            { id: "obit_col", title: "Obituary URL", type: "link" },
          ],
        })),
      },
      mondayConfig: {
        MONDAY_CLIENT_ID: "client-id",
        MONDAY_CLIENT_SECRET: "secret",
        MONDAY_REDIRECT_URI: "http://localhost:3000/auth/callback",
      },
      tenantId: "pilot",
    });

    expect(validation.ready).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_required_board_field",
          field: "tier",
        }),
      ]),
    );
  });

  it("reports refresh readiness when a refresh token is available", async () => {
    const tokenStore = new MemoryTokenStore();
    await tokenStore.saveTenantState("pilot", {
      oauth: {
        access_token: "token-123",
        refresh_token: "refresh-123",
        account_id: "acct-1",
      },
      selected_board: {
        id: "board-1",
        name: "Leads",
        columns: [
          { id: "owner_col", title: "Owner Name", type: "text" },
          { id: "obit_col", title: "Obituary URL", type: "link" },
          { id: "tier_col", title: "Tier", type: "status" },
        ],
      },
      board_mapping: {
        item_name_strategy: "deceased_name_county",
        columns: {
          owner_name: "owner_col",
          obituary_url: "obit_col",
          tier: "tier_col",
        },
      },
    });

    const validation = await buildPreScanValidation({
      tokenStore,
      mondayClient: {
        getMe: vi.fn(async () => ({ id: "user-1", name: "Pilot User" })),
        getBoard: vi.fn(async () => ({
          id: "board-1",
          name: "Leads",
          columns: [
            { id: "owner_col", title: "Owner Name", type: "text" },
            { id: "obit_col", title: "Obituary URL", type: "link" },
            { id: "tier_col", title: "Tier", type: "status" },
          ],
        })),
      },
      mondayConfig: {
        MONDAY_CLIENT_ID: "client-id",
        MONDAY_CLIENT_SECRET: "secret",
        MONDAY_REDIRECT_URI: "http://localhost:3000/auth/callback",
      },
      tenantId: "pilot",
    });

    expect(validation.ready).toBe(true);
    expect(validation.token_validation.refresh.status).toBe("ready");
  });

  it("returns actionable issues when token validation fails", async () => {
    const tokenStore = new MemoryTokenStore();
    await tokenStore.saveTenantState("pilot", {
      oauth: { access_token: "bad-token", account_id: "acct-1" },
    });

    const validation = await buildPreScanValidation({
      tokenStore,
      mondayClient: {
        getMe: vi.fn(async () => {
          throw new Error("401 Unauthorized");
        }),
      },
      mondayConfig: {
        MONDAY_CLIENT_ID: "client-id",
        MONDAY_CLIENT_SECRET: "secret",
        MONDAY_REDIRECT_URI: "http://localhost:3000/auth/callback",
      },
      tenantId: "pilot",
    });

    expect(validation.ready).toBe(false);
    expect(validation.token_validation.status).toBe("invalid_token");
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "oauth_token_invalid" }),
        expect.objectContaining({ code: "board_not_selected" }),
      ]),
    );
  });
});
