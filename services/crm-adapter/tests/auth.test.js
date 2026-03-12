const os = require("os");
const request = require("supertest");
const path = require("path");

const { createApp } = require("../src/app");
const { FileTokenStore } = require("../src/tokenStore");

function buildLead(overrides = {}) {
  return {
    scan_id: "scan-1",
    source: "reaper",
    run_started_at: "2026-03-11T10:00:00Z",
    run_completed_at: "2026-03-11T10:01:00Z",
    owner_name: "Jordan Example",
    deceased_name: "Pat Example",
    property: {
      address_line_1: "123 County Road",
      city: "Austin",
      state: "TX",
      postal_code: "78701",
      county: "Travis",
    },
    contacts: [
      {
        name: "Casey Example",
        relationship: "heir",
        phone: "555-0100",
        email: "casey@example.com",
        mailing_address: "PO Box 1",
      },
    ],
    notes: ["pilot-ready"],
    tags: ["inheritance"],
    raw_artifacts: ["artifact-1.json"],
    ...overrides,
  };
}

describe("crm-adapter auth routes", () => {
  it("reports pilot runtime visibility on /health", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
    };
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-health-${Date.now()}.json`),
    });
    const app = createApp({
      mondayClient,
      tokenStore,
      leadEngineBaseUrl: "http://lead-engine",
      clientId: "client-id",
      clientSecret: "secret",
      redirectUri: "http://localhost:3000/auth/callback",
    });

    const response = await request(app).get("/health");

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "crm-adapter",
      lead_engine_base_url: "http://lead-engine",
      monday_oauth_configured: true,
      token_store_path: tokenStore.filePath,
    });
  });

  it("fails readiness when pilot dependencies are not configured", async () => {
    const app = createApp({
      mondayClient: {
        getAuthorizationUrl: vi.fn(),
      },
      leadEngineBaseUrl: "",
      clientId: "",
      clientSecret: "",
      redirectUri: "",
    });

    const response = await request(app).get("/ready");

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      status: "not_ready",
      service: "crm-adapter",
      missing_configuration: [
        "LEAD_ENGINE_BASE_URL",
        "MONDAY_CLIENT_ID",
        "MONDAY_CLIENT_SECRET",
        "MONDAY_REDIRECT_URI",
      ],
    });
  });

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

  it("lists boards using the persisted OAuth token", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoards: vi.fn(async () => [
        { id: "board-1", name: "Leads", columns: [{ id: "name", title: "Name" }] },
      ]),
    };
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-boards-${Date.now()}.json`),
    });
    await tokenStore.saveState({
      tokens: {
        monday_access_token: "token-123",
      },
      account_id: "acct-1",
    });
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app).get("/boards");

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      boards: [{ id: "board-1", name: "Leads", columns: [{ id: "name", title: "Name" }] }],
      selected_board: null,
      tenant_id: "pilot",
    });
    expect(mondayClient.listBoards).toHaveBeenCalledWith("token-123");
  });

  it("persists the selected board from discovered boards", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoards: vi.fn(async () => [
        { id: "board-1", name: "Leads", columns: [{ id: "name", title: "Name" }] },
        { id: "board-2", name: "Archive", columns: [] },
      ]),
    };
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-board-select-${Date.now()}.json`),
    });
    await tokenStore.saveState({
      tokens: {
        monday_access_token: "token-123",
      },
    });
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app).post("/boards/select").send({ board_id: "board-1" });
    const state = await tokenStore.getState();

    expect(response.statusCode).toBe(200);
    expect(response.body.selected_board).toEqual({
      id: "board-1",
      name: "Leads",
      columns: [{ id: "name", title: "Name" }],
    });
    expect(response.body.tenant_id).toBe("pilot");
    expect(state.board).toEqual({
      id: "board-1",
      name: "Leads",
      columns: [{ id: "name", title: "Name" }],
    });
  });

  it("returns persisted board mapping for the selected board", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
    };
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-mapping-${Date.now()}.json`),
    });
    await tokenStore.saveState({
      tokens: {
        monday_access_token: "token-123",
      },
      board: {
        id: "board-1",
        name: "Leads",
        columns: [{ id: "name", title: "Name" }],
      },
    });
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app).get("/mapping");

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      tenant_id: "pilot",
      board_id: "board-1",
      mapping: {
        item_name_strategy: "deceased_name_address",
        columns: {
          deceased_name: "name",
          owner_name: "text",
          property_address: "text",
          contact_count: "numbers",
          tags: "text",
        },
      },
    });
  });

  it("persists updated board mapping", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
    };
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-mapping-save-${Date.now()}.json`),
    });
    await tokenStore.saveState({
      tokens: {
        monday_access_token: "token-123",
      },
      board: {
        id: "board-1",
        name: "Leads",
        columns: [{ id: "name", title: "Name" }],
      },
    });
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app).put("/mapping").send({
      item_name_strategy: "deceased_name_only",
      columns: {
        deceased_name: "name",
        owner_name: "owner_column",
      },
    });
    const tenantState = await tokenStore.getTenantState("pilot");

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      tenant_id: "pilot",
      board_id: "board-1",
      mapping: {
        item_name_strategy: "deceased_name_only",
        columns: {
          deceased_name: "name",
          owner_name: "owner_column",
          property_address: "text",
          contact_count: "numbers",
          tags: "text",
        },
      },
    });
    expect(tenantState.board_mapping.item_name_strategy).toBe("deceased_name_only");
  });

  it("creates a Monday item from the internal lead contract on the selected board", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoardItems: vi.fn(async () => []),
      createItem: vi.fn(async () => ({ id: "item-123" })),
    };
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-leads-${Date.now()}.json`),
    });
    await tokenStore.saveState({
      tokens: {
        monday_access_token: "token-123",
      },
      board: {
        id: "board-1",
        name: "Leads",
        columns: [{ id: "name", title: "Name" }],
      },
    });
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app).post("/leads").send(buildLead());

    expect(response.statusCode).toBe(201);
    expect(response.body).toEqual({
      tenant_id: "pilot",
      board_id: "board-1",
      delivery_id: expect.any(String),
      status: "created",
      item_id: "item-123",
      item_name: "Pat Example - 123 County Road",
      lead: {
        deceased_name: "Pat Example",
        owner_name: "Jordan Example",
        property_address: "123 County Road, Austin, TX, 78701",
        contact_count: 1,
        tags: ["inheritance"],
        scan_id: "scan-1",
        source: "reaper",
      },
    });
    expect(mondayClient.createItem).toHaveBeenCalledWith({
      token: "token-123",
      boardId: "board-1",
      itemName: "Pat Example - 123 County Road",
      columnValues: {
        name: "Pat Example",
        text: "inheritance",
        numbers: "1",
      },
    });
  });

  it("rejects malformed internal lead payloads before Monday item creation", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoardItems: vi.fn(async () => []),
      createItem: vi.fn(async () => ({ id: "item-123" })),
    };
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-invalid-leads-${Date.now()}.json`),
    });
    await tokenStore.saveState({
      tokens: {
        monday_access_token: "token-123",
      },
      board: {
        id: "board-1",
        name: "Leads",
      },
    });
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app).post("/leads").send({
      scan_id: "",
      property: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: "Invalid internal lead field: scan_id",
    });
    expect(mondayClient.createItem).not.toHaveBeenCalled();
  });

  it("skips duplicate Monday items and records the outcome", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoardItems: vi.fn(async () => [{ id: "item-123", name: "Pat Example - 123 County Road" }]),
      createItem: vi.fn(async () => ({ id: "item-999" })),
    };
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-duplicate-leads-${Date.now()}.json`),
    });
    await tokenStore.saveState({
      tokens: {
        monday_access_token: "token-123",
      },
      board: {
        id: "board-1",
        name: "Leads",
        columns: [{ id: "name", title: "Name" }],
      },
    });
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app).post("/leads").send(buildLead());
    const tenantState = await tokenStore.getTenantState("pilot");

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe("skipped_duplicate");
    expect(response.body.duplicate_of).toBe("item-123");
    expect(mondayClient.createItem).not.toHaveBeenCalled();
    expect(tenantState.deliveries[0].status).toBe("skipped_duplicate");
  });

  it("persists failed delivery attempts for operator visibility", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoardItems: vi.fn(async () => []),
      createItem: vi.fn(async () => {
        throw new Error("Monday API request failed with status 500");
      }),
    };
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-failed-leads-${Date.now()}.json`),
    });
    await tokenStore.saveState({
      tokens: {
        monday_access_token: "token-123",
      },
      board: {
        id: "board-1",
        name: "Leads",
        columns: [{ id: "name", title: "Name" }],
      },
    });
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app).post("/leads").send(buildLead());
    const deliveriesResponse = await request(app).get("/deliveries");

    expect(response.statusCode).toBe(502);
    expect(response.body.status).toBe("failed");
    expect(deliveriesResponse.statusCode).toBe(200);
    expect(deliveriesResponse.body.deliveries[0].status).toBe("failed");
    expect(deliveriesResponse.body.scan_runs[0].scan_id).toBe("scan-1");
  });

  it("returns operator-ready status state", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
    };
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-status-${Date.now()}.json`),
    });
    await tokenStore.saveTenantState("pilot", {
      oauth: { access_token: "token-123", account_id: "acct-1" },
      selected_board: {
        id: "board-1",
        name: "Leads",
        columns: [{ id: "name", title: "Name" }],
      },
      deliveries: [{ id: "delivery-1", status: "created" }],
      scan_runs: [{ scan_id: "scan-1", last_delivery_status: "created" }],
    });
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app).get("/status");

    expect(response.statusCode).toBe(200);
    expect(response.body.board.id).toBe("board-1");
    expect(response.body.latest_delivery.id).toBe("delivery-1");
    expect(response.body.scan_runs[0].scan_id).toBe("scan-1");
  });

  it("runs the first scan flow and returns delivery totals", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoardItems: vi.fn(async () => []),
      createItem: vi.fn(async ({ itemName }) => ({ id: `${itemName}-id` })),
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        scan_id: "scan-1",
        status: "completed",
        lead_count: 2,
        leads: [
          buildLead(),
          buildLead({
            deceased_name: "Taylor Example",
            property: {
              address_line_1: "456 Ranch Road",
              city: "Austin",
              state: "TX",
              postal_code: "78702",
              county: "Travis",
            },
          }),
        ],
      }),
    }));
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-first-scan-${Date.now()}.json`),
    });
    await tokenStore.saveState({
      tokens: {
        monday_access_token: "token-123",
      },
      board: {
        id: "board-1",
        name: "Leads",
        columns: [{ id: "name", title: "Name" }],
      },
    });
    const app = createApp({ mondayClient, tokenStore, fetchImpl, leadEngineBaseUrl: "http://lead-engine" });

    const response = await request(app).post("/first-scan").send({
      county: "Travis",
      state: "TX",
      limit: 2,
    });

    expect(response.statusCode).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://lead-engine/run-scan",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(response.body.scan_id).toBe("scan-1");
    expect(response.body.totals).toEqual({
      created: 2,
      skipped_duplicate: 0,
      failed: 0,
    });
    expect(response.body.status.deliveries).toHaveLength(2);
  });

  it("separates persisted state by tenant id", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoards: vi.fn(async () => [{ id: "board-2", name: "Tenant 2 Board", columns: [] }]),
    };
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-tenant-split-${Date.now()}.json`),
    });
    await tokenStore.saveTenantState("pilot", {
      oauth: { access_token: "pilot-token", account_id: "pilot-account" },
      selected_board: { id: "board-1", name: "Pilot Board", columns: [] },
    });
    await tokenStore.saveTenantState("tenant-2", {
      oauth: { access_token: "tenant-2-token", account_id: "tenant-2-account" },
      selected_board: { id: "board-2", name: "Tenant 2 Board", columns: [] },
    });
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app).get("/boards").set("x-tenant-id", "tenant-2");

    expect(response.statusCode).toBe(200);
    expect(response.body.selected_board).toEqual({
      id: "board-2",
      name: "Tenant 2 Board",
      columns: [],
    });
    expect(response.body.tenant_id).toBe("tenant-2");
    expect(mondayClient.listBoards).toHaveBeenCalledWith("tenant-2-token");
  });
});
