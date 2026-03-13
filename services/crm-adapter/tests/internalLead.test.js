const fs = require("fs");

const {
  getLeadSchemaPath,
  mapLeadToMondayItemWithMapping,
  validateBoardMapping,
  validateLead,
} = require("../src/leadContract");

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
      parcel_ids: ["parcel-1"],
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

describe("lead contract helpers", () => {
  it("points to the shared schema artifact", () => {
    const schemaPath = getLeadSchemaPath();

    expect(fs.existsSync(schemaPath)).toBe(true);
  });

  it("accepts a valid lead payload", () => {
    const lead = buildLead();

    expect(validateLead(lead)).toEqual(lead);
  });

  it("rejects a malformed lead payload", () => {
    expect(() =>
      validateLead({
        scan_id: "",
        property: {},
      }),
    ).toThrow("Invalid lead field: scan_id");
  });

  it("accepts partial board mappings", () => {
    expect(
      validateBoardMapping({
        item_name_strategy: "deceased_name_county",
        columns: {
          deceased_name: "name",
        },
      }),
    ).toEqual({
      item_name_strategy: "deceased_name_county",
      columns: {
        deceased_name: "name",
      },
    });
  });

  it("emits mapped Monday column values using board column types", () => {
    const result = mapLeadToMondayItemWithMapping(
      buildLead({ idempotency_key: "lead:v1:test" }),
      {
        item_name_strategy: "deceased_name_county",
        columns: {
          deceased_name: "name",
          idempotency_key: "dedupe_key",
          match_score: "confidence",
          obituary_url: "obit_link",
          tier: "status",
          out_of_state_heir_likely: "oos_checkbox",
          heirs_formatted: "heirs",
        },
      },
      [
        { id: "name", type: "text" },
        { id: "dedupe_key", type: "text" },
        { id: "confidence", type: "numbers" },
        { id: "obit_link", type: "link" },
        { id: "status", type: "status" },
        { id: "oos_checkbox", type: "checkbox" },
        { id: "heirs", type: "long-text" },
      ],
    );

    expect(result.itemName).toBe("Pat Example - Boone County");
    expect(result.columnValues).toEqual({
      name: "Pat Example",
      dedupe_key: "lead:v1:test",
      confidence: 96.2,
      obit_link: { url: "https://example.com/obit", text: "View Obituary" },
      status: { label: "Hot" },
      oos_checkbox: { checked: true },
      heirs: "Casey Example (son) - Phoenix, AZ [OOS]",
    });
  });
});
