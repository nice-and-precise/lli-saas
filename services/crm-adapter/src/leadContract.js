const fs = require("fs");
const path = require("path");

const LEAD_SCHEMA_PATH_CANDIDATES = [
  path.resolve(__dirname, "..", "..", "..", "shared", "contracts", "lead.schema.json"),
  path.resolve(__dirname, "..", "..", "shared", "contracts", "lead.schema.json"),
];

function getLeadSchemaPath() {
  const existingPath = LEAD_SCHEMA_PATH_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  return existingPath ?? LEAD_SCHEMA_PATH_CANDIDATES[0];
}

function assertNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid lead field: ${field}`);
  }
}

function validateLead(lead) {
  if (!lead || typeof lead !== "object" || Array.isArray(lead)) {
    throw new Error("Invalid lead payload");
  }

  ["scan_id", "source", "run_started_at", "run_completed_at", "owner_name", "deceased_name"].forEach(
    (field) => assertNonEmptyString(lead[field], field),
  );

  if (!lead.property || typeof lead.property !== "object" || Array.isArray(lead.property)) {
    throw new Error("Invalid lead field: property");
  }

  ["address_line_1", "city", "state", "postal_code", "county"].forEach((field) =>
    assertNonEmptyString(lead.property[field], `property.${field}`),
  );

  if (!Array.isArray(lead.contacts)) {
    throw new Error("Invalid lead field: contacts");
  }

  lead.contacts.forEach((contact, index) => {
    if (!contact || typeof contact !== "object" || Array.isArray(contact)) {
      throw new Error(`Invalid lead contact at index ${index}`);
    }

    ["name", "relationship"].forEach((field) =>
      assertNonEmptyString(contact[field], `contacts[${index}].${field}`),
    );
  });

  if (!Array.isArray(lead.notes) || !Array.isArray(lead.tags) || !Array.isArray(lead.raw_artifacts)) {
    throw new Error("Invalid lead list fields");
  }

  return lead;
}

function normalizeMappedValue(value) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (typeof value === "number") {
    return String(value);
  }

  return value ?? "";
}

function buildItemName(lead, itemNameStrategy) {
  if (itemNameStrategy === "deceased_name_only") {
    return lead.deceased_name.trim();
  }

  return `${lead.deceased_name} - ${lead.property.address_line_1}`.trim();
}

function validateBoardMapping(mapping) {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    throw new Error("Invalid board mapping payload");
  }

  assertNonEmptyString(mapping.item_name_strategy, "item_name_strategy");

  if (!mapping.columns || typeof mapping.columns !== "object" || Array.isArray(mapping.columns)) {
    throw new Error("Invalid board mapping field: columns");
  }

  Object.entries(mapping.columns).forEach(([field, columnId]) => {
    assertNonEmptyString(field, `columns.${field}.field`);
    assertNonEmptyString(columnId, `columns.${field}`);
  });

  return mapping;
}

function mapLeadToMondayItemWithMapping(lead, mapping) {
  validateLead(lead);
  validateBoardMapping(mapping);

  const address = [
    lead.property.address_line_1,
    lead.property.city,
    lead.property.state,
    lead.property.postal_code,
  ]
    .filter(Boolean)
    .join(", ");

  const itemName = buildItemName(lead, mapping.item_name_strategy);
  const summary = {
    deceased_name: lead.deceased_name,
    owner_name: lead.owner_name,
    property_address: address,
    contact_count: lead.contacts.length,
    tags: lead.tags,
    scan_id: lead.scan_id,
    source: lead.source,
  };
  const columnValues = Object.fromEntries(
    Object.entries(mapping.columns).map(([field, columnId]) => [columnId, normalizeMappedValue(summary[field])]),
  );

  return {
    itemName,
    columnValues,
    summary,
  };
}

module.exports = {
  getLeadSchemaPath,
  mapLeadToMondayItemWithMapping,
  validateBoardMapping,
  validateLead,
};
