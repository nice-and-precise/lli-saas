const os = require("os");
const request = require("supertest");
const path = require("path");

const { createApp } = require("../src/app");
const { FileTokenStore } = require("../src/tokenStore");

describe("crm-adapter auth routes", () => {
  it("redirects to Monday OAuth on /auth/login", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(() => "https://auth.monday.com/oauth2/authorize?client_id=test"),
    };
    const app = createApp({ mondayClient });

    const response = await request(app).get("/auth/login");

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("auth.monday.com/oauth2/authorize");
    expect(mondayClient.getAuthorizationUrl).toHaveBeenCalled();
  });

  it("exchanges code and stores token on /auth/callback", async () => {
    const mondayClient = {
      exchangeCodeForToken: vi.fn(async () => ({
        access_token: "token-123",
        account_id: "acct-1",
      })),
      getAuthorizationUrl: vi.fn(),
    };
    const tokenStore = {
      save: vi.fn(async () => {}),
    };
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app).get("/auth/callback?code=abc123");

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      connected: true,
      account_id: "acct-1",
    });
    expect(mondayClient.exchangeCodeForToken).toHaveBeenCalledWith("abc123");
    expect(tokenStore.save).toHaveBeenCalledWith("monday_access_token", "token-123");
  });

  it("exposes the shared internal lead contract path", async () => {
    const app = createApp({
      mondayClient: {
        getAuthorizationUrl: vi.fn(() => "https://auth.monday.com/oauth2/authorize?client_id=test"),
      },
    });

    const response = await request(app).get("/contract");

    expect(response.statusCode).toBe(200);
    expect(response.body.contract_path).toBe(
      path.resolve(__dirname, "..", "..", "..", "shared", "contracts", "internal-lead.schema.json"),
    );
  });

  it("persists OAuth state with the file token store", async () => {
    const mondayClient = {
      exchangeCodeForToken: vi.fn(async () => ({
        access_token: "token-123",
        account_id: "acct-1",
      })),
      getAuthorizationUrl: vi.fn(),
    };
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-auth-state-${Date.now()}.json`),
    });
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app).get("/auth/callback?code=abc123");
    const state = await tokenStore.getState();

    expect(response.statusCode).toBe(200);
    expect(state.tokens.monday_access_token).toBe("token-123");
    expect(state.account_id).toBe("acct-1");
  });
});
