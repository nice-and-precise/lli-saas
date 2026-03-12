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
            { id: "county", text: "Travis", column: { title: "County" } },
            { id: "state", text: "TX", column: { title: "State" } },
            { id: "acreage", text: "120.5", column: { title: "Acreage" } },
            { id: "apn", text: "parcel-1, parcel-2", column: { title: "APN" } },
            { id: "mail_state", text: "TX", column: { title: "Mail State" } },
          ],
        },
      ],
    });

    expect(owners).toEqual([
      {
        owner_id: "owner-1",
        owner_name: "Jordan Example",
        county: "Travis",
        state: "TX",
        acres: 120.5,
        parcel_ids: ["parcel-1", "parcel-2"],
        mailing_state: "TX",
        crm_source: "monday",
        raw_source_ref: "board:clients-board:item:owner-1",
      },
    ]);
  });
});
