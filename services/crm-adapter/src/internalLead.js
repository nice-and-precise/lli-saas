const path = require("path");

const INTERNAL_LEAD_SCHEMA_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "shared",
  "contracts",
  "internal-lead.schema.json",
);

function getInternalLeadSchemaPath() {
  return INTERNAL_LEAD_SCHEMA_PATH;
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

module.exports = {
  getInternalLeadSchemaPath,
  validateInternalLead,
};
