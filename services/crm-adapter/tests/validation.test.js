const {
  buildValidationResponse,
  normalizeMappingInput,
  validateMondaySetup,
} = require("../src/validation");
const { MemoryTokenStore, createDefaultMapping } = require("../src/tokenStore");

describe("validation helpers", () => {
  it("normalizes preview mapping input without leaking empty fields", () => {
    const mapping = normalizeMappingInput(
      {
        item_name_strategy: "deceased_name_only",
        columns: {
          deceased_name: " name ",
          tier: "",
          obituary_url: " obit_link ",
        },
      },
      createDefaultMapping(),
    );

    expect(mapping).toEqual({
      item_name_strategy: "deceased_name_only",
      columns: {
        deceased_name: "name",
        obituary_url: "obit_link",
      },
    });
  });

  it("reports missing credentials before reaching Monday", async () => {
    const tokenStore = new MemoryTokenStore();
    const state = await tokenStore.getState();

    const result = await validateMondaySetup({
      mondayClient: {
        listBoards: async () => {
          throw new Error("should not be called");
        },
      },
      mondayConfig: {
        MONDAY_CLIENT_ID: "",
        MONDAY_CLIENT_SECRET: "",
        MONDAY_REDIRECT_URI: "",
      },
      state,
      sourceBoardName: "Clients",
    });

    expect(result.capabilities.token_present).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "token_missing",
      "oauth_app_missing",
    ]);
  });

  it("validates boards, permissions, and mapping suggestions", async () => {
    const state = {
      tokens: { monday_access_token: "token-123" },
      board: { id: "board-2", name: "Leads" },
      board_mapping: {
        item_name_strategy: "deceased_name_county",
        columns: {
          deceased_name: "namez",
          tier: "status",
          obituary_url: "wrong_link",
        },
      },
    };

    const mondayClient = {
      listBoards: async () => [
        {
          id: "board-1",
          name: "Clients",
          columns: [{ id: "owner_name", title: "Owner Name", type: "text" }],
        },
        {
          id: "board-2",
          name: "Leads",
          columns: [
            { id: "name", title: "Deceased Name", type: "text" },
            { id: "status", title: "Tier", type: "status" },
            { id: "obit_link", title: "Obituary URL", type: "link" },
            { id: "score", title: "Match Score", type: "numbers" },
          ],
        },
      ],
      listBoardItems: async ({ boardId }) => {
        if (boardId === "board-2") {
          return [];
        }
        return [];
      },
    };

    const result = await validateMondaySetup({
      mondayClient,
      mondayConfig: {
        MONDAY_CLIENT_ID: "client-id",
        MONDAY_CLIENT_SECRET: "secret",
        MONDAY_REDIRECT_URI: "http://localhost/callback",
      },
      state,
      sourceBoardName: "Clients",
    });

    expect(result.capabilities.monday_api_reachable).toBe(true);
    expect(result.capabilities.source_board_readable).toBe(true);
    expect(result.capabilities.destination_board_readable).toBe(true);
    expect(result.issues.some((issue) => issue.code === "mapped_column_missing")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "recommended_mapping_missing")).toBe(true);
    expect(result.suggestions.some((suggestion) => suggestion.action.value === "name")).toBe(true);
    expect(result.suggestions.some((suggestion) => suggestion.action.value === "obit_link")).toBe(true);
  });

  it("builds a ready response when no blocking issues remain", () => {
    const response = buildValidationResponse({
      tenantId: "pilot",
      preview: false,
      issues: [],
      suggestions: [],
      capabilities: {
        oauth_app_configured: true,
        token_present: true,
        monday_api_reachable: true,
        source_board_readable: true,
        destination_board_readable: true,
        destination_board_write: "not_tested",
      },
      responseState: {
        source_board: { id: "board-1", name: "Clients" },
        selected_board: { id: "board-2", name: "Leads", columns: [] },
        mapping: { item_name_strategy: "deceased_name_county", mapped_field_count: 3 },
      },
    });

    expect(response.ready).toBe(true);
    expect(response.can_start_scan).toBe(true);
    expect(response.summary).toEqual({ error_count: 0, warning_count: 0, info_count: 0 });
  });
});
