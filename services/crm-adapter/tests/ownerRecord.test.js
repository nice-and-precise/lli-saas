const fs = require("fs");

const {
  getOwnerRecordSchemaPath,
  normalizeMondayOwnerRecords,
} = require("../src/ownerRecord");

describe("owner record helpers", () => {
  it("points to the shared owner schema artifact", () => {
    const schemaPath = getOwnerRecordSchemaPath();

    expect(fs.existsSync(schemaPath)).toBe(true);
  });

  it("normalizes Monday items into canonical owner records", () => {
    const owners = normalizeMondayOwnerRecords({
      boardId: "clients-board",
      items: [
        {
          id: "owner-1",
          name: "Jordan Example",
          column_values: [
            { id: "county", text: "Boone", column: { title: "County" } },
            { id: "state", text: "IA", column: { title: "State" } },
            { id: "acreage", text: "120.5", column: { title: "Acreage" } },
            { id: "apn", text: "parcel-1, parcel-2", column: { title: "APN" } },
            { id: "mail_state", text: "IA", column: { title: "Mail State" } },
            { id: "mail_city", text: "Boone", column: { title: "Mail City" } },
            { id: "mail_zip", text: "50036", column: { title: "Mail Zip" } },
            { id: "property_address", text: "123 County Road", column: { title: "Property Address" } },
            { id: "property_city", text: "Boone", column: { title: "Property City" } },
            { id: "property_zip", text: "50036", column: { title: "Property Zip" } },
            { id: "tenant_name", text: "Johnson Farms LLC", column: { title: "Tenant Name" } },
          ],
        },
      ],
    });

    expect(owners).toEqual([
      {
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
      },
    ]);
  });
});
