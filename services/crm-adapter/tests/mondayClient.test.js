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

  it("lists boards from the GraphQL response", async () => {
    const post = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        data: {
          boards: [{ id: "123", name: "Leads", columns: [{ id: "name", title: "Name" }] }],
        },
      },
      headers: {},
    });
    const client = new MondayClient({
      clientId: "client-id",
      clientSecret: "secret",
      redirectUri: "http://localhost:3000/auth/callback",
      httpClient: { post },
    });

    await expect(client.listBoards("token-123")).resolves.toEqual([
      { id: "123", name: "Leads", columns: [{ id: "name", title: "Name" }] },
    ]);
  });

  it("creates an item with GraphQL variables", async () => {
    const post = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        data: {
          create_item: { id: "item-1" },
        },
      },
      headers: {},
    });
    const client = new MondayClient({
      clientId: "client-id",
      clientSecret: "secret",
      redirectUri: "http://localhost:3000/auth/callback",
      httpClient: { post },
    });

    await expect(
      client.createItem({
        token: "token-123",
        boardId: "board-1",
        itemName: "Pat Example - 123 County Road",
        columnValues: {
          owner_column: "Jordan Example",
        },
      }),
    ).resolves.toEqual({ id: "item-1" });

    expect(post).toHaveBeenCalledWith(
      "https://api.monday.com/v2",
      expect.objectContaining({
        variables: {
          boardId: "board-1",
          itemName: "Pat Example - 123 County Road",
          columnValues: JSON.stringify({
            owner_column: "Jordan Example",
          }),
        },
      }),
      expect.any(Object),
    );
  });

  it("lists board items for duplicate checks", async () => {
    const post = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        data: {
          boards: [
            {
              id: "board-1",
              items_page: {
                items: [{ id: "item-1", name: "Pat Example - 123 County Road" }],
              },
            },
          ],
        },
      },
      headers: {},
    });
    const client = new MondayClient({
      clientId: "client-id",
      clientSecret: "secret",
      redirectUri: "http://localhost:3000/auth/callback",
      httpClient: { post },
    });

    await expect(
      client.listBoardItems({
        token: "token-123",
        boardId: "board-1",
      }),
    ).resolves.toEqual([{ id: "item-1", name: "Pat Example - 123 County Road" }]);
  });
});
