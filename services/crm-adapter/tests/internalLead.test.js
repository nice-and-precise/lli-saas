const fs = require("fs");

const { getInternalLeadSchemaPath, validateInternalLead } = require("../src/internalLead");

describe("internal lead contract helpers", () => {
  it("points to the shared schema artifact", () => {
    const schemaPath = getInternalLeadSchemaPath();

    expect(fs.existsSync(schemaPath)).toBe(true);
  });

  it("accepts a valid internal lead payload", () => {
    const lead = {
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
    };

    expect(validateInternalLead(lead)).toEqual(lead);
  });

  it("rejects a malformed internal lead payload", () => {
    expect(() =>
      validateInternalLead({
        scan_id: "",
        property: {},
      }),
    ).toThrow("Invalid internal lead field: scan_id");
  });
});
