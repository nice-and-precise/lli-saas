const os = require("os");
const request = require("supertest");
const path = require("path");

const { buildTransactionId, createApp, SOURCE_OWNER_BOARD_NAME } = require("../src/app");
const { FileTokenStore } = require("../src/tokenStore");

function buildLead(overrides = {}) {
  return {
    scan_id: "scan-1",
    source: "obituary_intelligence_engine",
    run_started_at: "2026-03-11T10:00:00Z",
    run_completed_at: "2026-03-11T10:01:00Z",
    owner_id: "owner-1",
    owner_name: "Jordan Example",
    deceased_name: "Pat Example",
    property: {
      county: "Boone",
      state: "IA",
      acres: 120.5,
      parcel_ids: ["parcel-1", "parcel-2"],
      address_line_1: "123 County Road",
      city: "Boone",
      postal_code: "50036",
      operator_name: "Johnson Farms LLC",
    },
    heirs: [
      {
        name: "Casey Example",
        relationship: "son",
        location_city: "Phoenix",
        location_state: "AZ",
        out_of_state: true,
        phone: null,
        email: null,
        mailing_address: null,
        executor: false,
      },
    ],
    obituary: {
      url: "https://example.com/obit",
      source_id: "kwbg_boone",
      published_at: "2026-03-11T10:00:00Z",
      death_date: "2026-03-10",
      deceased_city: "Boone",
      deceased_state: "IA",
    },
    match: {
      score: 96.2,
      last_name_score: 100,
      first_name_score: 90.5,
      location_bonus_applied: true,
      status: "auto_confirmed",
    },
    tier: "hot",
    out_of_state_heir_likely: true,
    out_of_state_states: ["AZ"],
    executor_mentioned: false,
    unexpected_death: false,
    notes: ["pilot-ready"],
    tags: ["tier:hot", "signal:out_of_state_heir"],
    raw_artifacts: ["artifact-1.json"],
    ...overrides,
  };
}

describe("crm-adapter routes", () => {
  it("reports runtime visibility on /health", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
    };
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-health-${Date.now()}.json`),
    });
    const app = createApp({
      mondayClient,
      tokenStore,
      clientId: "client-id",
      clientSecret: "secret",
      redirectUri: "http://localhost:3000/auth/callback",
    });

    const response = await request(app).get("/health");

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "crm-adapter",
      monday_oauth_configured: true,
      source_owner_board_name: SOURCE_OWNER_BOARD_NAME,
      token_store_path: tokenStore.filePath,
    });
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

  it("lists boards using the persisted OAuth token", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoards: vi.fn(async () => [
        { id: "board-1", name: "Leads", columns: [{ id: "name", title: "Name", type: "text" }] },
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
      boards: [{ id: "board-1", name: "Leads", columns: [{ id: "name", title: "Name", type: "text" }] }],
      selected_board: null,
      tenant_id: "pilot",
    });
    expect(mondayClient.listBoards).toHaveBeenCalledWith("token-123");
  });

  it("returns canonical owner records from the Clients board", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoards: vi.fn(async () => [
        { id: "clients-board", name: "Clients", columns: [{ id: "county", title: "County", type: "text" }] },
      ]),
      listBoardItems: vi.fn(async () => [
        {
          id: "owner-1",
          name: "Jordan Example",
          column_values: [
            { id: "county", text: "Boone", column: { title: "County" } },
            { id: "state", text: "IA", column: { title: "State" } },
            { id: "acreage", text: "120.5", column: { title: "Acreage" } },
            { id: "apn", text: "parcel-1; parcel-2", column: { title: "APN" } },
            { id: "mail_state", text: "IA", column: { title: "Mail State" } },
            { id: "mail_city", text: "Boone", column: { title: "Mail City" } },
            { id: "mail_zip", text: "50036", column: { title: "Mail Zip" } },
            { id: "property_address", text: "123 County Road", column: { title: "Property Address" } },
            { id: "property_city", text: "Boone", column: { title: "Property City" } },
            { id: "property_zip", text: "50036", column: { title: "Property Zip" } },
            { id: "tenant_name", text: "Johnson Farms LLC", column: { title: "Tenant Name" } },
          ],
        },
      ]),
    };
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-owners-${Date.now()}.json`),
    });
    await tokenStore.saveState({
      tokens: {
        monday_access_token: "token-123",
      },
    });
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app).get("/owners?limit=500");

    expect(response.statusCode).toBe(200);
    expect(response.body.owners[0]).toEqual({
      owner_id: "owner-1",
      owner_name: "Jordan Example",
      county: "Boone",
      state: "IA",
      acres: 120.5,
      parcel_ids: ["parcel-1", "parcel-2"],
      mailing_state: "IA",
      mailing_city: "Boone",
      mailing_postal_code: "50036",
      property_address_line_1: "123 County Road",
      property_city: "Boone",
      property_postal_code: "50036",
      operator_name: "Johnson Farms LLC",
      crm_source: "monday",
      raw_source_ref: "board:clients-board:item:owner-1",
    });
  });

  it("rejects invalid lead payloads before Monday delivery", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoardItems: vi.fn(async () => []),
      createItem: vi.fn(async () => ({ id: "item-1" })),
    };
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-invalid-lead-${Date.now()}.json`),
    });
    await tokenStore.saveTenantState("pilot", {
      oauth: { access_token: "token-123", account_id: "acct-1" },
      board: {
        id: "board-1",
        name: "Leads",
        columns: [{ id: "name", title: "Name", type: "text" }],
      },
    });
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app)
      .post("/leads")
      .send(buildLead({ run_started_at: "bad-timestamp" }));

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: "Invalid lead field: run_started_at",
      details: "Lead payload validation failed before Monday delivery",
    });
    expect(mondayClient.listBoardItems).not.toHaveBeenCalled();
    expect(mondayClient.createItem).not.toHaveBeenCalled();
  });

  it("persists the selected destination board from discovered boards", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoards: vi.fn(async () => [
        { id: "board-1", name: "Leads", columns: [{ id: "name", title: "Name", type: "text" }] },
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
      columns: [{ id: "name", title: "Name", type: "text" }],
    });
    expect(state.board.columns[0].type).toBe("text");
  });

  it("persists updated board mapping with the new default strategy", async () => {
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
        columns: [{ id: "name", title: "Name", type: "text" }],
      },
    });
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app).put("/mapping").send({
      item_name_strategy: "deceased_name_county",
      columns: {
        deceased_name: "name",
        tier: "status",
        obituary_url: "obit_link",
      },
    });
    const tenantState = await tokenStore.getTenantState("pilot");

    expect(response.statusCode).toBe(200);
    expect(response.body.mapping.item_name_strategy).toBe("deceased_name_county");
    expect(tenantState.board_mapping.columns.tier).toBe("status");
  });

  it("builds a stable transaction id for the same lead identity", () => {
    const lead = buildLead();

    expect(buildTransactionId("pilot", lead)).toBe(buildTransactionId("pilot", buildLead()));
    expect(buildTransactionId("pilot", lead)).not.toBe(buildTransactionId("other-tenant", lead));
  });

  it("creates a Monday item from the canonical lead contract on the selected board", async () => {
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
        columns: [
          { id: "name", title: "Name", type: "text" },
          { id: "score", title: "Match Score", type: "numbers" },
          { id: "status", title: "Tier", type: "status" },
          { id: "obit_link", title: "Obit Link", type: "link" },
        ],
      },
      board_mapping: {
        item_name_strategy: "deceased_name_county",
        columns: {
          deceased_name: "name",
          match_score: "score",
          tier: "status",
          obituary_url: "obit_link",
        },
      },
    });
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app).post("/leads").send(buildLead());

    expect(response.statusCode).toBe(201);
    expect(response.body.transaction_id).toBe(buildTransactionId("pilot", response.body.lead));
    expect(response.body.item_name).toBe("Pat Example - Boone County");
    expect(response.body.lead).toEqual({
      deceased_name: "Pat Example",
      owner_name: "Jordan Example",
      owner_id: "owner-1",
      property_address: "123 County Road, Boone, IA, 50036",
      county: "Boone",
      acres: 120.5,
      operator_name: "Johnson Farms LLC",
      death_date: "2026-03-10",
      obituary_source: "kwbg_boone",
      obituary_url: "https://example.com/obit",
      match_score: 96.2,
      match_status: "auto_confirmed",
      tier: "hot",
      heir_count: 1,
      heirs_formatted: "Casey Example (son) - Phoenix, AZ [OOS]",
      out_of_state_heir_likely: true,
      out_of_state_states: ["AZ"],
      executor_mentioned: false,
      unexpected_death: false,
      tags: ["tier:hot", "signal:out_of_state_heir"],
      scan_id: "scan-1",
      source: "obituary_intelligence_engine",
    });
    expect(mondayClient.createItem).toHaveBeenCalledWith({
      token: "token-123",
      boardId: "board-1",
      itemName: "Pat Example - Boone County",
      columnValues: {
        name: "Pat Example",
        score: 96.2,
        status: { label: "Hot" },
        obit_link: { url: "https://example.com/obit", text: "View Obituary" },
      },
    });
  });

  it("skips an idempotent retry when the same transaction already created an item", async () => {
    const lead = buildLead();
    const transactionId = buildTransactionId("pilot", lead);
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoardItems: vi.fn(async () => []),
      createItem: vi.fn(async () => ({ id: "item-999" })),
    };
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-idempotent-retry-${Date.now()}.json`),
    });
    await tokenStore.saveState({
      tokens: {
        monday_access_token: "token-123",
      },
      board: {
        id: "board-1",
        name: "Leads",
        columns: [{ id: "name", title: "Name", type: "text" }],
      },
      deliveries: [
        {
          id: "delivery-1",
          transaction_id: transactionId,
          item_id: "item-123",
          item_name: "Pat Example - Boone County",
          obituary_url: "https://example.com/obit",
          fallback_duplicate_key: "pat example::2026 03 10::owner 1",
          status: "created",
          summary: {
            obituary_url: "https://example.com/obit",
          },
        },
      ],
    });
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app).post("/leads").send(lead);
    const tenantState = await tokenStore.getTenantState("pilot");

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe("skipped_idempotent_retry");
    expect(response.body.transaction_id).toBe(transactionId);
    expect(response.body.duplicate_of).toBe("item-123");
    expect(mondayClient.listBoardItems).not.toHaveBeenCalled();
    expect(mondayClient.createItem).not.toHaveBeenCalled();
    expect(tenantState.deliveries[0].status).toBe("skipped_idempotent_retry");
  });

  it("retries a previously failed delivery without creating duplicates", async () => {
    const lead = buildLead();
    const transactionId = buildTransactionId("pilot", lead);
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoardItems: vi.fn(async () => []),
      createItem: vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary Monday outage"))
        .mockResolvedValueOnce({ id: "item-234" }),
    };
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-retry-after-failure-${Date.now()}.json`),
    });
    await tokenStore.saveState({
      tokens: {
        monday_access_token: "token-123",
      },
      board: {
        id: "board-1",
        name: "Leads",
        columns: [{ id: "name", title: "Name", type: "text" }],
      },
    });
    const app = createApp({ mondayClient, tokenStore });

    const firstResponse = await request(app).post("/leads").send(lead);
    const secondResponse = await request(app).post("/leads").send(lead);
    const tenantState = await tokenStore.getTenantState("pilot");

    expect(firstResponse.statusCode).toBe(502);
    expect(firstResponse.body.transaction_id).toBe(transactionId);
    expect(secondResponse.statusCode).toBe(201);
    expect(secondResponse.body.transaction_id).toBe(transactionId);
    expect(mondayClient.createItem).toHaveBeenCalledTimes(2);
    expect(tenantState.deliveries[0].status).toBe("created");
    expect(tenantState.deliveries[1].status).toBe("failed");
  });

  it("skips duplicate Monday items using the persisted obituary identity", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoardItems: vi.fn(async () => []),
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
        columns: [{ id: "name", title: "Name", type: "text" }],
      },
      deliveries: [
        {
          id: "delivery-1",
          item_id: "item-123",
          item_name: "Pat Example - Boone County",
          obituary_url: "https://example.com/obit",
          fallback_duplicate_key: "pat example::2026 03 10::owner 1",
          status: "created",
          summary: {
            obituary_url: "https://example.com/obit",
          },
        },
      ],
    });
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app).post("/leads").send(buildLead({ scan_id: "scan-2" }));
    const tenantState = await tokenStore.getTenantState("pilot");

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe("skipped_duplicate");
    expect(response.body.duplicate_of).toBe("item-123");
    expect(mondayClient.createItem).not.toHaveBeenCalled();
    expect(tenantState.deliveries[0].status).toBe("skipped_duplicate");
  });

  it("treats a post-failure board hit as an idempotent-safe duplicate recovery", async () => {
    const lead = buildLead();
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoardItems: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "item-345", name: "https://example.com/obit", column_values: [] }]),
      createItem: vi.fn().mockRejectedValueOnce(new Error("timeout after create submitted")),
    };
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-post-failure-recovery-${Date.now()}.json`),
    });
    await tokenStore.saveState({
      tokens: {
        monday_access_token: "token-123",
      },
      board: {
        id: "board-1",
        name: "Leads",
        columns: [{ id: "name", title: "Name", type: "text" }],
      },
    });
    const app = createApp({ mondayClient, tokenStore });

    const firstResponse = await request(app).post("/leads").send(lead);
    const secondResponse = await request(app).post("/leads").send(lead);

    expect(firstResponse.statusCode).toBe(502);
    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.body.status).toBe("skipped_duplicate");
    expect(secondResponse.body.item_id).toBe("item-345");
    expect(mondayClient.createItem).toHaveBeenCalledTimes(1);
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
        columns: [{ id: "name", title: "Name", type: "text" }],
      },
      deliveries: [{ id: "delivery-1", status: "created", summary: { tier: "hot" } }],
      scan_runs: [{ scan_id: "scan-1", last_delivery_status: "created" }],
    });
    const app = createApp({ mondayClient, tokenStore });

    const response = await request(app).get("/status");

    expect(response.statusCode).toBe(200);
    expect(response.body.board.id).toBe("board-1");
    expect(response.body.latest_delivery.id).toBe("delivery-1");
    expect(response.body.scan_runs[0].scan_id).toBe("scan-1");
  });
});
