const { MondayClient } = require("../src/mondayClient");

describe("MondayClient", () => {
  it("builds the Monday authorization URL", () => {
    const client = new MondayClient({
      clientId: "client-id",
      clientSecret: "secret",
      redirectUri: "http://localhost:3000/auth/callback",
      httpClient: { post: vi.fn() },
    });

    const url = client.getAuthorizationUrl("state-1");

    expect(url).toContain("client_id=client-id");
    expect(url).toContain("state=state-1");
  });

  it("retries 429 responses up to 3 times", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ status: 429, headers: { "retry-after": "0" } })
      .mockResolvedValueOnce({ status: 429, headers: { "retry-after": "0" } })
      .mockResolvedValueOnce({ status: 200, data: { data: { boards: [] } }, headers: {} });
    const sleep = vi.fn(async () => {});
    const client = new MondayClient({
      clientId: "client-id",
      clientSecret: "secret",
      redirectUri: "http://localhost:3000/auth/callback",
      httpClient: { post },
      sleep,
    });

    const result = await client.executeGraphQL({
      query: "query { boards { id } }",
      token: "token-123",
    });

    expect(result).toEqual({ data: { boards: [] } });
    expect(post).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("fails after the third 429 response", async () => {
    const post = vi.fn().mockResolvedValue({
      status: 429,
      headers: { "retry-after": "0" },
    });
    const sleep = vi.fn(async () => {});
    const client = new MondayClient({
      clientId: "client-id",
      clientSecret: "secret",
      redirectUri: "http://localhost:3000/auth/callback",
      httpClient: { post },
      sleep,
    });

    await expect(
      client.executeGraphQL({
        query: "query { boards { id } }",
        token: "token-123",
      }),
    ).rejects.toThrow("Monday API rate limit exceeded after 3 attempts");
    expect(post).toHaveBeenCalledTimes(3);
  });
});
