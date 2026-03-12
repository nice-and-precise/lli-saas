const fs = require("fs");

const { getLeadSchemaPath, validateLead } = require("../src/leadContract");

describe("lead contract helpers", () => {
  it("points to the shared schema artifact", () => {
    const schemaPath = getLeadSchemaPath();

    expect(fs.existsSync(schemaPath)).toBe(true);
  });

  it("accepts a valid lead payload", () => {
    const lead = {
      scan_id: "scan-1",
      source: "obituary_intelligence_engine",
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
    };

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
});
