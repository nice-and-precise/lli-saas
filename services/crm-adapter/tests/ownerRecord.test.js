const fs = require("fs");

const {
  detectOwnerSourceBoard,
  getOwnerRecordSchemaPath,
  normalizeMondayOwnerRecords,
  scoreOwnerBoard,
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

describe("owner source-board detection", () => {
  // Shapes mirror a real pilot Monday account: a landowner board vs the default
  // "Welcome to your developer account" board (only the generic Name column).
  const clientsBoard = {
    id: "18415000827",
    name: "Clients",
    columns: [
      { id: "name", title: "Name", type: "name" },
      { id: "county", title: "County", type: "text" },
      { id: "state", title: "State", type: "text" },
    ],
  };
  const welcomeBoard = {
    id: "18414986562",
    name: "Welcome to your developer account",
    columns: [
      { id: "name", title: "Name", type: "name" },
      { id: "files", title: "Files", type: "file" },
    ],
  };

  it("scores land-specific signals above the generic Name column", () => {
    // County (+2) + State (+2) + owner_name via "Name" (+1) = 5.
    expect(scoreOwnerBoard(clientsBoard).score).toBe(5);
    // Only the default Name column = owner_name (+1).
    expect(scoreOwnerBoard(welcomeBoard).score).toBe(1);
  });

  it("picks the landowner board and never a Name-only board", () => {
    const { best, ranked } = detectOwnerSourceBoard([welcomeBoard, clientsBoard]);
    expect(best?.name).toBe("Clients");
    // The Name-only board is below the minScore=2 threshold, so it isn't a candidate.
    expect(ranked.map((entry) => entry.board.name)).toEqual(["Clients"]);
  });

  it("returns no candidate when nothing looks like an owner board", () => {
    const { best, ranked } = detectOwnerSourceBoard([welcomeBoard]);
    expect(best).toBeNull();
    expect(ranked).toHaveLength(0);
  });

  it("matches owner columns by alias (e.g. APN → parcel_ids, Acreage → acres)", () => {
    const board = {
      id: "b1",
      name: "Land Book",
      columns: [
        { id: "apn", title: "APN", type: "text" },
        { id: "acreage", title: "Acreage", type: "numbers" },
        { id: "operator", title: "Operator", type: "text" },
      ],
    };
    const { matchedFields } = scoreOwnerBoard(board);
    expect(matchedFields).toEqual(expect.arrayContaining(["parcel_ids", "acres", "operator_name"]));
  });
});
