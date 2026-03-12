const fs = require("fs");
const path = require("path");

const OWNER_RECORD_SCHEMA_PATH_CANDIDATES = [
  path.resolve(__dirname, "..", "..", "..", "shared", "contracts", "owner-record.schema.json"),
  path.resolve(__dirname, "..", "..", "shared", "contracts", "owner-record.schema.json"),
];

const OWNER_FIELD_ALIASES = {
  owner_name: ["owner_name", "owner", "client_name", "name"],
  county: ["county"],
  state: ["state"],
  acres: ["acres", "acreage"],
  parcel_ids: ["parcel_id", "parcel_ids", "parcel", "apn", "apns"],
  mailing_state: ["mailing_state", "mail_state"],
  mailing_city: ["mailing_city", "mail_city", "city"],
  mailing_postal_code: ["mailing_postal_code", "mail_postal_code", "mail_zip", "zip"],
  property_address_line_1: ["property_address_line_1", "property_address", "address", "address_line_1"],
  property_city: ["property_city", "property_town", "farm_city"],
  property_postal_code: ["property_postal_code", "property_zip", "property_zip_code"],
  operator_name: ["operator_name", "tenant_name", "who_farms_it", "farmer", "operator"],
};

function getOwnerRecordSchemaPath() {
  const existingPath = OWNER_RECORD_SCHEMA_PATH_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  return existingPath ?? OWNER_RECORD_SCHEMA_PATH_CANDIDATES[0];
}

function normalizeLookupKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseAcres(value) {
  if (value == null || value === "") {
    return null;
  }

  const normalized = String(value).replace(/,/g, "").trim();
  if (normalized === "") {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseParcelIds(value) {
  if (value == null || value === "") {
    return [];
  }

  return String(value)
    .split(/[\n,;|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildColumnLookup(item) {
  const lookup = {};
  for (const columnValue of item.column_values ?? []) {
    const value = columnValue.text ?? "";
    const keys = [columnValue.id, columnValue.column?.title];
    for (const key of keys) {
      const normalizedKey = normalizeLookupKey(key);
      if (normalizedKey) {
        lookup[normalizedKey] = value;
      }
    }
  }
  return lookup;
}

function firstMappedValue(lookup, aliases) {
  for (const alias of aliases) {
    const normalizedAlias = normalizeLookupKey(alias);
    if (lookup[normalizedAlias]) {
      return lookup[normalizedAlias];
    }
  }
  return null;
}

function validateOwnerRecord(ownerRecord) {
  if (!ownerRecord || typeof ownerRecord !== "object" || Array.isArray(ownerRecord)) {
    throw new Error("Invalid owner record payload");
  }

  if (typeof ownerRecord.owner_id !== "string" || ownerRecord.owner_id.trim() === "") {
    throw new Error("Invalid owner record field: owner_id");
  }

  if (typeof ownerRecord.owner_name !== "string" || ownerRecord.owner_name.trim() === "") {
    throw new Error("Invalid owner record field: owner_name");
  }

  if (typeof ownerRecord.crm_source !== "string" || ownerRecord.crm_source.trim() === "") {
    throw new Error("Invalid owner record field: crm_source");
  }

  if (!Array.isArray(ownerRecord.parcel_ids)) {
    throw new Error("Invalid owner record field: parcel_ids");
  }

  return ownerRecord;
}

function mapMondayItemToOwnerRecord({ boardId, item }) {
  const lookup = buildColumnLookup(item);
  const ownerName = item.name?.trim() || firstMappedValue(lookup, OWNER_FIELD_ALIASES.owner_name);
  const ownerRecord = {
    owner_id: String(item.id),
    owner_name: ownerName ?? "",
    county: firstMappedValue(lookup, OWNER_FIELD_ALIASES.county),
    state: firstMappedValue(lookup, OWNER_FIELD_ALIASES.state),
    acres: parseAcres(firstMappedValue(lookup, OWNER_FIELD_ALIASES.acres)),
    parcel_ids: parseParcelIds(firstMappedValue(lookup, OWNER_FIELD_ALIASES.parcel_ids)),
    mailing_state: firstMappedValue(lookup, OWNER_FIELD_ALIASES.mailing_state),
    mailing_city: firstMappedValue(lookup, OWNER_FIELD_ALIASES.mailing_city),
    mailing_postal_code: firstMappedValue(lookup, OWNER_FIELD_ALIASES.mailing_postal_code),
    property_address_line_1: firstMappedValue(lookup, OWNER_FIELD_ALIASES.property_address_line_1),
    property_city: firstMappedValue(lookup, OWNER_FIELD_ALIASES.property_city),
    property_postal_code: firstMappedValue(lookup, OWNER_FIELD_ALIASES.property_postal_code),
    operator_name: firstMappedValue(lookup, OWNER_FIELD_ALIASES.operator_name),
    crm_source: "monday",
    raw_source_ref: `board:${boardId}:item:${item.id}`,
  };

  return validateOwnerRecord(ownerRecord);
}

function normalizeMondayOwnerRecords({ boardId, items }) {
  return items.map((item) => mapMondayItemToOwnerRecord({ boardId, item }));
}

module.exports = {
  getOwnerRecordSchemaPath,
  mapMondayItemToOwnerRecord,
  normalizeMondayOwnerRecords,
  validateOwnerRecord,
};
