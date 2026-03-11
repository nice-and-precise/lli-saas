const fs = require("fs");
const path = require("path");

const INTERNAL_LEAD_SCHEMA_PATH_CANDIDATES = [
  path.resolve(__dirname, "..", "..", "..", "shared", "contracts", "internal-lead.schema.json"),
  path.resolve(__dirname, "..", "..", "shared", "contracts", "internal-lead.schema.json"),
];

function getInternalLeadSchemaPath() {
  const existingPath = INTERNAL_LEAD_SCHEMA_PATH_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  return existingPath ?? INTERNAL_LEAD_SCHEMA_PATH_CANDIDATES[0];
}

function assertNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid internal lead field: ${field}`);
  }
}

function validateInternalLead(lead) {
  if (!lead || typeof lead !== "object" || Array.isArray(lead)) {
    throw new Error("Invalid internal lead payload");
  }

  [
    "scan_id",
    "source",
    "run_started_at",
    "run_completed_at",
    "owner_name",
    "deceased_name",
  ].forEach((field) => assertNonEmptyString(lead[field], field));

  if (!lead.property || typeof lead.property !== "object" || Array.isArray(lead.property)) {
    throw new Error("Invalid internal lead field: property");
  }

  ["address_line_1", "city", "state", "postal_code", "county"].forEach((field) =>
    assertNonEmptyString(lead.property[field], `property.${field}`),
  );

  if (!Array.isArray(lead.contacts)) {
    throw new Error("Invalid internal lead field: contacts");
  }

  lead.contacts.forEach((contact, index) => {
    if (!contact || typeof contact !== "object" || Array.isArray(contact)) {
      throw new Error(`Invalid internal lead contact at index ${index}`);
    }

    ["name", "relationship"].forEach((field) =>
      assertNonEmptyString(contact[field], `contacts[${index}].${field}`),
    );
  });

  if (!Array.isArray(lead.notes) || !Array.isArray(lead.tags) || !Array.isArray(lead.raw_artifacts)) {
    throw new Error("Invalid internal lead list fields");
  }

  return lead;
}

function mapInternalLeadToMondayItem(lead) {
  validateInternalLead(lead);

  const address = [
    lead.property.address_line_1,
    lead.property.city,
    lead.property.state,
    lead.property.postal_code,
  ]
    .filter(Boolean)
    .join(", ");

  const itemName = `${lead.deceased_name} - ${lead.property.address_line_1}`.trim();

  return {
    itemName,
    summary: {
      deceased_name: lead.deceased_name,
      owner_name: lead.owner_name,
      property_address: address,
      contact_count: lead.contacts.length,
      tags: lead.tags,
      scan_id: lead.scan_id,
      source: lead.source,
    },
  };
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

module.exports = {
  getInternalLeadSchemaPath,
  mapInternalLeadToMondayItem,
  validateBoardMapping,
  validateInternalLead,
};
