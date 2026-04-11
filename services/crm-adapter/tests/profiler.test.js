const request = require("supertest");

const { createApp } = require("../src/app");
const { createProfilingReport, jaccardSimilarity } = require("../src/profiler");

function buildOwner(overrides = {}) {
  return {
    owner_id: "owner-1",
    owner_name: "Jordan Example",
    county: "Boone",
    state: "IA",
    acres: 120.5,
    parcel_ids: ["parcel-1"],
    mailing_state: "IA",
    mailing_city: "Boone",
    mailing_postal_code: "50036",
    property_address_line_1: "123 County Road",
    property_city: "Boone",
    property_postal_code: "50036",
    operator_name: "Johnson Farms LLC",
    crm_source: "monday",
    raw_source_ref: "board:clients:item:owner-1",
    ...overrides,
  };
}

describe("owner data profiling", () => {
  it("classifies readiness and field coverage for a clean dataset", () => {
    const report = createProfilingReport([
      buildOwner(),
      buildOwner({
        owner_id: "owner-2",
        owner_name: "Taylor Example",
        parcel_ids: ["parcel-2"],
        property_address_line_1: "999 Main Street",
        mailing_postal_code: "50309",
        property_postal_code: "50309",
      }),
    ]);

    expect(report.readiness).toBe("ready");
    expect(report.summary.blocker_count).toBe(0);
    expect(report.summary.warning_count).toBe(0);
    expect(report.field_coverage.owner_name.completion_rate).toBe(1);
  });

  it("emits blockers, warnings, and info issues from config-driven checks", () => {
    const report = createProfilingReport([
      buildOwner({
        owner_id: "",
        county: "",
        state: "Iowa",
        parcel_ids: [],
        mailing_state: "Texas",
        mailing_city: "",
        mailing_postal_code: "50A36",
        property_address_line_1: "",
        property_city: "",
        property_postal_code: "50036",
        operator_name: "",
        raw_source_ref: "",
      }),
    ]);

    expect(report.readiness).toBe("blocked");
    expect(report.summary.blocker_count).toBeGreaterThan(0);
    expect(report.summary.warning_count).toBeGreaterThan(0);
    expect(report.summary.info_count).toBeGreaterThan(0);
    expect(report.issues.some((issue) => issue.code === "missing_required_field" && issue.field === "owner_id")).toBe(true);
    expect(report.issues.some((issue) => issue.code === "invalid_format" && issue.field === "state")).toBe(true);
    expect(report.issues.some((issue) => issue.code === "cross_field_inconsistency" && issue.field === "property_city")).toBe(true);
  });

  it("detects exact and lightweight fuzzy duplicate candidates", () => {
    const report = createProfilingReport([
      buildOwner(),
      buildOwner({
        owner_id: "owner-1",
        raw_source_ref: "board:clients:item:owner-1-copy",
      }),
      buildOwner({
        owner_id: "owner-3",
        owner_name: "Jordan E Example",
        property_address_line_1: "123 County Rd",
        parcel_ids: ["parcel-3"],
      }),
    ]);

    expect(report.summary.exact_duplicate_count).toBeGreaterThan(0);
    expect(report.summary.fuzzy_duplicate_count).toBeGreaterThan(0);
    expect(report.issues.some((issue) => issue.code === "duplicate_candidate_exact")).toBe(true);
    expect(report.issues.some((issue) => issue.code === "duplicate_candidate_fuzzy")).toBe(true);
  });

  it("exposes a portal-friendly JSON contract on POST /owners/profile", async () => {
    const app = createApp({
      mondayClient: {
        getAuthorizationUrl: vi.fn(),
      },
      tokenStore: {
        getState: vi.fn(async () => ({ tokens: {}, board_mapping: { item_name_strategy: "deceased_name_county", columns: {} } })),
        getTenantState: vi.fn(async () => ({ oauth: {}, selected_board: null, board_mapping: { item_name_strategy: "deceased_name_county", columns: {} }, scan_runs: [], deliveries: [] })),
      },
    });

    const response = await request(app)
      .post("/owners/profile")
      .send({
        dataset_name: "broker-upload-1",
        owner_records: [buildOwner({ owner_id: "", county: "" })],
      });

    expect(response.statusCode).toBe(200);
    expect(response.body.tenant_id).toBe("pilot");
    expect(response.body.report.dataset.name).toBe("broker-upload-1");
    expect(response.body.report.summary.blocker_count).toBeGreaterThan(0);
    expect(Array.isArray(response.body.report.issues)).toBe(true);
    expect(response.body.report.issues[0]).toEqual(
      expect.objectContaining({
        severity: expect.any(String),
        code: expect.any(String),
        message: expect.any(String),
        record_index: expect.any(Number),
      }),
    );
  });

  it("computes stable fuzzy similarity scores", () => {
    const score = jaccardSimilarity(new Set(["jordan", "example", "road"]), new Set(["jordan", "example", "rd"]));
    expect(score).toBeGreaterThan(0.4);
    expect(score).toBeLessThan(1);
  });
});
