const fs = require("fs");
const os = require("os");
const request = require("supertest");
const path = require("path");

const { createApp, SOURCE_OWNER_BOARD_NAME } = require("../src/app");
const { getAuthConfig, signJwt, signOAuthState } = require("../src/auth");
const { FileTokenStore } = require("../src/tokenStore");

const AUTH_OPTIONS = {
  jwtSecret: "test-jwt-secret",
  issuer: "lli-saas-tests",
  audience: "lli-saas",
  operatorEmail: "pilot@example.com",
  operatorPassword: "test-password",
  operatorTenantId: "pilot",
  portalBaseUrl: "https://portal.example.com",
};

function buildAccessToken(claims = {}, authOverrides = AUTH_OPTIONS) {
  return signJwt(
    {
      sub: "pilot@example.com",
      role: "operator",
      tenant_id: "pilot",
      ...claims,
    },
    getAuthConfig(authOverrides),
  );
}

function buildAuthHeader(claims = {}, authOverrides = AUTH_OPTIONS) {
  return {
    Authorization: `Bearer ${buildAccessToken(claims, authOverrides)}`,
  };
}

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
      auth: AUTH_OPTIONS,
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
      saveTenantState: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    };
    const app = createApp({ mondayClient, tokenStore, auth: AUTH_OPTIONS });
    const state = signOAuthState(
      {
        sub: "pilot@example.com",
        role: "operator",
        tenant_id: "pilot",
      },
      getAuthConfig(AUTH_OPTIONS),
    );

    const response = await request(app).get(`/auth/callback?code=abc123&state=${state}`);

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://portal.example.com/dashboard?monday=connected");
    expect(mondayClient.exchangeCodeForToken).toHaveBeenCalledWith("abc123");
    expect(tokenStore.saveTenantState).toHaveBeenCalledWith("pilot", {
      oauth: {
        access_token: "token-123",
        account_id: "acct-1",
      },
    });
  });

  it("rejects OAuth callback requests with an invalid signed state", async () => {
    const app = createApp({ auth: AUTH_OPTIONS, mondayClient: { exchangeCodeForToken: vi.fn() } });

    const response = await request(app).get("/auth/callback?code=abc123&state=not-a-jwt");

    expect(response.statusCode).toBe(401);
    expect(response.body.error).toMatch(/invalid oauth state/i);
  });

  it("returns an upstream error when the OAuth code exchange fails", async () => {
    const mondayClient = {
      exchangeCodeForToken: vi.fn(async () => {
        throw new Error("monday unavailable");
      }),
      getAuthorizationUrl: vi.fn(),
    };
    const app = createApp({ mondayClient, auth: AUTH_OPTIONS });
    const state = signOAuthState(
      {
        sub: "pilot@example.com",
        role: "operator",
        tenant_id: "pilot",
      },
      getAuthConfig(AUTH_OPTIONS),
    );

    const response = await request(app).get(`/auth/callback?code=abc123&state=${state}`);

    expect(response.statusCode).toBe(502);
    expect(response.body.error).toMatch(/failed to exchange monday oauth code/i);
  });

  it("issues an operator session token from /session/login", async () => {
    const app = createApp({ auth: AUTH_OPTIONS });

    const response = await request(app).post("/session/login").send({
      email: "pilot@example.com",
      password: "test-password",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.token_type).toBe("Bearer");
    expect(response.body.claims.tenant_id).toBe("pilot");
  });

  it("rejects unauthenticated requests on protected routes", async () => {
    const app = createApp({ auth: AUTH_OPTIONS });

    const response = await request(app).get("/status");

    expect(response.statusCode).toBe(401);
    expect(response.body.error).toMatch(/missing bearer token/i);
  });

  it("rejects invalid bearer tokens on protected routes", async () => {
    const app = createApp({ auth: AUTH_OPTIONS });

    const response = await request(app).get("/status").set("Authorization", "Bearer not-a-jwt");

    expect(response.statusCode).toBe(401);
    expect(response.body.error).toMatch(/invalid bearer token/i);
  });

  it("rejects spoofed x-tenant-id headers on protected routes", async () => {
    const app = createApp({ auth: AUTH_OPTIONS });

    const response = await request(app)
      .get("/status")
      .set(buildAuthHeader())
      .set("x-tenant-id", "spoofed-tenant");

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toMatch(/x-tenant-id does not match authenticated tenant/i);
  });

  it("lists boards using the persisted OAuth token for the verified tenant", async () => {
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
      active_tenant_id: "pilot",
      tokens: {
        monday_access_token: "token-123",
      },
      account_id: "acct-1",
    });
    const app = createApp({ mondayClient, tokenStore, auth: AUTH_OPTIONS });

    const response = await request(app).get("/boards").set(buildAuthHeader());

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      boards: [
        { id: "board-1", name: "Leads", columns: [{ id: "name", title: "Name", type: "text" }] },
      ],
      selected_board: null,
      tenant_id: "pilot",
    });
    expect(mondayClient.listBoards).toHaveBeenCalledWith("token-123", {
      tenant_id: "pilot",
    });
  });

  it("returns canonical owner records from the Clients board", async () => {
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoards: vi.fn(async () => [
        {
          id: "clients-board",
          name: "Clients",
          columns: [{ id: "county", title: "County", type: "text" }],
        },
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
            {
              id: "property_address",
              text: "123 County Road",
              column: { title: "Property Address" },
            },
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
      active_tenant_id: "pilot",
      tokens: {
        monday_access_token: "token-123",
      },
    });
    const app = createApp({ mondayClient, tokenStore, auth: AUTH_OPTIONS });

    const response = await request(app).get("/owners?limit=500").set(buildAuthHeader());

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
    const app = createApp({ mondayClient, tokenStore, auth: AUTH_OPTIONS });

    const response = await request(app)
      .post("/boards/select")
      .set(buildAuthHeader())
      .send({ board_id: "board-1" });
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
    const app = createApp({ mondayClient, tokenStore, auth: AUTH_OPTIONS });

    const response = await request(app)
      .put("/mapping")
      .set(buildAuthHeader())
      .send({
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
    const app = createApp({ mondayClient, tokenStore, auth: AUTH_OPTIONS });

    const response = await request(app).post("/leads").set(buildAuthHeader()).send(buildLead());

    expect(response.statusCode).toBe(201);
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
      idempotency_key: expect.stringMatching(/^lead:v1:/),
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
      context: {
        tenant_id: "pilot",
        scan_id: "scan-1",
      },
    });
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
    const app = createApp({ mondayClient, tokenStore, auth: AUTH_OPTIONS });

    const response = await request(app).post("/leads").set(buildAuthHeader()).send(buildLead());
    const tenantState = await tokenStore.getTenantState("pilot");

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe("skipped_duplicate");
    expect(response.body.duplicate_of).toBe("item-123");
    expect(mondayClient.createItem).not.toHaveBeenCalled();
    expect(tenantState.deliveries[0].status).toBe("skipped_duplicate");
  });

  it("skips replayed deliveries after restart using persisted idempotency state", async () => {
    const filePath = path.join(os.tmpdir(), `lli-saas-restart-dedupe-${Date.now()}.json`);
    const initialStore = new FileTokenStore({ filePath });
    await initialStore.saveState({
      tokens: {
        monday_access_token: "token-123",
      },
      board: {
        id: "board-1",
        name: "Leads",
        columns: [{ id: "name", title: "Name", type: "text" }],
      },
      board_mapping: {
        item_name_strategy: "deceased_name_county",
        columns: {
          deceased_name: "name",
        },
      },
    });

    const initialMondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoardItems: vi.fn(async () => []),
      createItem: vi.fn(async () => ({ id: "item-123" })),
    };
    const initialApp = createApp({
      mondayClient: initialMondayClient,
      tokenStore: initialStore,
      auth: AUTH_OPTIONS,
    });

    const created = await request(initialApp)
      .post("/leads")
      .set(buildAuthHeader())
      .send(buildLead());
    expect(created.statusCode).toBe(201);

    const restartedStore = new FileTokenStore({ filePath });
    const restartedMondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoardItems: vi.fn(async () => []),
      createItem: vi.fn(async () => ({ id: "item-999" })),
    };
    const restartedApp = createApp({
      mondayClient: restartedMondayClient,
      tokenStore: restartedStore,
      auth: AUTH_OPTIONS,
    });

    const replay = await request(restartedApp)
      .post("/leads")
      .set(buildAuthHeader())
      .send(buildLead());

    expect(replay.statusCode).toBe(200);
    expect(replay.body.status).toBe("skipped_duplicate");
    expect(replay.body.duplicate_of).toBe("item-123");
    expect(restartedMondayClient.createItem).not.toHaveBeenCalled();
  });

  it("uses a mapped idempotency column to skip duplicates after delivery state loss", async () => {
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-board-dedupe-${Date.now()}.json`),
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
          { id: "dedupe_key", title: "Idempotency Key", type: "text" },
        ],
      },
      board_mapping: {
        item_name_strategy: "deceased_name_county",
        columns: {
          deceased_name: "name",
          idempotency_key: "dedupe_key",
        },
      },
      deliveries: [],
    });
    const mondayClient = {
      getAuthorizationUrl: vi.fn(),
      listBoardItems: vi.fn(async () => []),
      createItem: vi.fn(async () => ({ id: "item-999" })),
    };
    const app = createApp({ mondayClient, tokenStore, auth: AUTH_OPTIONS });

    const previewResponse = await request(app)
      .post("/leads")
      .set(buildAuthHeader())
      .send(buildLead());
    const storedDelivery = (await tokenStore.getTenantState("pilot")).deliveries[0];

    mondayClient.listBoardItems.mockResolvedValueOnce([
      {
        id: "item-123",
        name: "Pat Example - Boone County",
        column_values: [{ id: "dedupe_key", text: storedDelivery.idempotency_key, value: null }],
      },
    ]);

    await tokenStore.saveTenantState("pilot", {
      deliveries: [],
      idempotency_index: {},
    });

    const replayResponse = await request(app)
      .post("/leads")
      .set(buildAuthHeader())
      .send(buildLead());

    expect(previewResponse.statusCode).toBe(201);
    expect(replayResponse.statusCode).toBe(200);
    expect(replayResponse.body.status).toBe("skipped_duplicate");
    expect(replayResponse.body.duplicate_of).toBe("item-123");
    expect(mondayClient.createItem).toHaveBeenCalledTimes(1);
  });

  it("returns an explicit state error when persisted state is corrupt", async () => {
    const filePath = path.join(os.tmpdir(), `lli-saas-status-corrupt-${Date.now()}.json`);
    fs.writeFileSync(filePath, "{broken-json", "utf-8");
    const tokenStore = new FileTokenStore({ filePath });
    const app = createApp({ tokenStore, auth: AUTH_OPTIONS });

    const response = await request(app).get("/status").set(buildAuthHeader());

    expect(response.statusCode).toBe(500);
    expect(response.body.error).toMatch(/state unavailable/i);
    expect(response.body.code).toBe("state_corruption");
    expect(response.body.state_path).toBe(filePath);
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
    const app = createApp({ mondayClient, tokenStore, auth: AUTH_OPTIONS });

    const response = await request(app).get("/status").set(buildAuthHeader());

    expect(response.statusCode).toBe(200);
    expect(response.body.board.id).toBe("board-1");
    expect(response.body.latest_delivery.id).toBe("delivery-1");
    expect(response.body.scan_runs[0].scan_id).toBe("scan-1");
  });

  it("allows service-role tokens on protected routes", async () => {
    const tokenStore = new FileTokenStore({
      filePath: path.join(os.tmpdir(), `lli-saas-service-status-${Date.now()}.json`),
    });
    await tokenStore.saveTenantState("pilot", {
      selected_board: {
        id: "board-1",
        name: "Leads",
        columns: [],
      },
    });
    const app = createApp({ tokenStore, auth: AUTH_OPTIONS });

    const response = await request(app)
      .get("/status")
      .set(buildAuthHeader({ role: "service", sub: "lead-engine" }));

    expect(response.statusCode).toBe(200);
    expect(response.body.tenant_id).toBe("pilot");
  });
});
