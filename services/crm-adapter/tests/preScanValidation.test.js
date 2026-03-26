const request = require("supertest");

const { createApp } = require("../src/app");
const { MemoryTokenStore } = require("../src/tokenStore");

describe("pre-scan Monday validation", () => {
  it("returns ready when token, board, and required mappings are valid", async () => {
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

    const mondayClient = {
      getMe: vi.fn(async () => ({ id: "user-1", name: "Pilot User", email: "pilot@example.com" })),
      getAuthorizationUrl: vi.fn(),
    };

    const app = createApp({
      tokenStore,
      mondayClient,
      clientId: "client-id",
      clientSecret: "secret",
      redirectUri: "http://localhost:3000/auth/callback",
    });

    const response = await request(app).get("/validation/pre-scan");

    expect(response.statusCode).toBe(200);
    expect(response.body.ready).toBe(true);
    expect(response.body.token_validation.status).toBe("valid");
    expect(response.body.board_validation.ok).toBe(true);
    expect(response.body.board_validation.field_results).toEqual(
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
        columns: [{ id: "owner_col", title: "Owner Name", type: "text" }],
      },
      board_mapping: {
        item_name_strategy: "deceased_name_county",
        columns: {
          owner_name: "owner_col",
        },
      },
    });

    const mondayClient = {
      getMe: vi.fn(async () => ({ id: "user-1", name: "Pilot User" })),
      getAuthorizationUrl: vi.fn(),
    };

    const app = createApp({
      tokenStore,
      mondayClient,
      clientId: "client-id",
      clientSecret: "secret",
      redirectUri: "http://localhost:3000/auth/callback",
    });

    const response = await request(app).get("/validation/pre-scan");

    expect(response.statusCode).toBe(409);
    expect(response.body.ready).toBe(false);
    expect(response.body.issues).toEqual(
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

  it("returns actionable issues when token validation fails", async () => {
    const tokenStore = new MemoryTokenStore();
    await tokenStore.saveTenantState("pilot", {
      oauth: { access_token: "bad-token", account_id: "acct-1" },
    });

    const mondayClient = {
      getMe: vi.fn(async () => {
        throw new Error("401 Unauthorized");
      }),
      getAuthorizationUrl: vi.fn(),
    };

    const app = createApp({
      tokenStore,
      mondayClient,
      clientId: "client-id",
      clientSecret: "secret",
      redirectUri: "http://localhost:3000/auth/callback",
    });

    const response = await request(app).get("/validation/pre-scan");

    expect(response.statusCode).toBe(409);
    expect(response.body.ready).toBe(false);
    expect(response.body.token_validation.status).toBe("invalid_token");
    expect(response.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "oauth_token_invalid" }),
        expect.objectContaining({ code: "board_not_selected" }),
      ]),
    );
  });
});
