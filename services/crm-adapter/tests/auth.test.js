const request = require("supertest");

const { createApp } = require("../src/app");

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
});
