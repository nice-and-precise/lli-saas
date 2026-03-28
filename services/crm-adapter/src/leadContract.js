const fs = require("fs");
const path = require("path");

const LEAD_SCHEMA_PATH_CANDIDATES = [
  path.resolve(__dirname, "..", "..", "..", "shared", "contracts", "lead.schema.json"),
  path.resolve(__dirname, "..", "..", "shared", "contracts", "lead.schema.json"),
];
const ALLOWED_ITEM_NAME_STRATEGIES = new Set([
  "deceased_name_county",
  "deceased_name_only",
  "deceased_name_address",
]);
const ALLOWED_MAPPED_FIELDS = new Set([
  "deceased_name",
  "owner_name",
  "owner_id",
  "property_address",
  "county",
  "acres",
  "operator_name",
  "death_date",
  "obituary_source",
  "obituary_url",
  "match_score",
  "match_status",
  "tier",
  "heir_count",
  "heirs_formatted",
  "out_of_state_heir_likely",
  "out_of_state_states",
  "executor_mentioned",
  "unexpected_death",
  "tags",
  "scan_id",
  "source",
]);

function getLeadSchemaPath() {
  const existingPath = LEAD_SCHEMA_PATH_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  return existingPath ?? LEAD_SCHEMA_PATH_CANDIDATES[0];
}

function assertNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid lead field: ${field}`);
  }
}

function assertOptionalString(value, field) {
  if (value != null && typeof value !== "string") {
    throw new Error(`Invalid lead field: ${field}`);
  }
}

function validateLead(lead) {
  if (!lead || typeof lead !== "object" || Array.isArray(lead)) {
    throw new Error("Invalid lead payload");
  }

  [
    "scan_id",
    "source",
    "run_started_at",
    "run_completed_at",
    "owner_id",
    "owner_name",
    "deceased_name",
  ].forEach((field) => assertNonEmptyString(lead[field], field));

  if (!lead.property || typeof lead.property !== "object" || Array.isArray(lead.property)) {
    throw new Error("Invalid lead field: property");
  }

  ["county", "state", "address_line_1", "city", "postal_code", "operator_name"].forEach((field) =>
    assertOptionalString(lead.property[field], `property.${field}`),
  );
  if (lead.property.acres != null && typeof lead.property.acres !== "number") {
    throw new Error("Invalid lead field: property.acres");
  }
  if (!Array.isArray(lead.property.parcel_ids)) {
    throw new Error("Invalid lead field: property.parcel_ids");
  }

  if (!Array.isArray(lead.heirs)) {
    throw new Error("Invalid lead field: heirs");
  }

  lead.heirs.forEach((heir, index) => {
    if (!heir || typeof heir !== "object" || Array.isArray(heir)) {
      throw new Error(`Invalid lead heir at index ${index}`);
    }

    ["name", "relationship"].forEach((field) =>
      assertNonEmptyString(heir[field], `heirs[${index}].${field}`),
    );
    ["location_city", "location_state", "phone", "email", "mailing_address"].forEach((field) =>
      assertOptionalString(heir[field], `heirs[${index}].${field}`),
    );
    ["out_of_state", "executor"].forEach((field) => {
      if (typeof heir[field] !== "boolean") {
        throw new Error(`Invalid lead field: heirs[${index}].${field}`);
      }
    });
  });

  if (!lead.obituary || typeof lead.obituary !== "object" || Array.isArray(lead.obituary)) {
    throw new Error("Invalid lead field: obituary");
  }
  ["url", "source_id"].forEach((field) => assertNonEmptyString(lead.obituary[field], `obituary.${field}`));
  ["published_at", "death_date", "deceased_city", "deceased_state"].forEach((field) =>
    assertOptionalString(lead.obituary[field], `obituary.${field}`),
  );

  if (!lead.match || typeof lead.match !== "object" || Array.isArray(lead.match)) {
    throw new Error("Invalid lead field: match");
  }
  ["score", "last_name_score", "first_name_score"].forEach((field) => {
    if (typeof lead.match[field] !== "number") {
      throw new Error(`Invalid lead field: match.${field}`);
    }
  });
  if (typeof lead.match.location_bonus_applied !== "boolean") {
    throw new Error("Invalid lead field: match.location_bonus_applied");
  }
  assertNonEmptyString(lead.match.status, "match.status");

  ["tier"].forEach((field) => assertNonEmptyString(lead[field], field));
  ["out_of_state_heir_likely", "executor_mentioned", "unexpected_death"].forEach((field) => {
    if (typeof lead[field] !== "boolean") {
      throw new Error(`Invalid lead field: ${field}`);
    }
  });
  if (!Array.isArray(lead.out_of_state_states)) {
    throw new Error("Invalid lead field: out_of_state_states");
  }

  if (!Array.isArray(lead.notes) || !Array.isArray(lead.tags) || !Array.isArray(lead.raw_artifacts)) {
    throw new Error("Invalid lead list fields");
  }

  return lead;
}

function formatPropertyAddress(property) {
  return [property.address_line_1, property.city, property.state, property.postal_code]
    .filter(Boolean)
    .join(", ");
}

function formatHeirs(heirs) {
  return heirs
    .map((heir) => {
      const location = [heir.location_city, heir.location_state].filter(Boolean).join(", ") || "location unknown";
      const oosFlag = heir.out_of_state ? " [OOS]" : "";
      return `${heir.name} (${heir.relationship}) - ${location}${oosFlag}`;
    })
    .join("\n");
}

function titleizeValue(value) {
  return String(value ?? "")
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function buildItemName(lead, itemNameStrategy) {
  if (itemNameStrategy === "deceased_name_only") {
    return lead.deceased_name.trim();
  }

  if (itemNameStrategy === "deceased_name_address") {
    const propertyAddress = formatPropertyAddress(lead.property);
    return propertyAddress ? `${lead.deceased_name} - ${propertyAddress}` : lead.deceased_name.trim();
  }

  const countySuffix = lead.property.county ? `${lead.property.county} County` : null;
  return countySuffix ? `${lead.deceased_name} - ${countySuffix}` : lead.deceased_name.trim();
}

function validateBoardMapping(mapping) {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    throw new Error("Invalid board mapping payload");
  }

  assertNonEmptyString(mapping.item_name_strategy, "item_name_strategy");
  if (!ALLOWED_ITEM_NAME_STRATEGIES.has(mapping.item_name_strategy)) {
    throw new Error("Invalid board mapping field: item_name_strategy");
  }

  if (!mapping.columns || typeof mapping.columns !== "object" || Array.isArray(mapping.columns)) {
    throw new Error("Invalid board mapping field: columns");
  }

  const seenColumnIds = new Set();

  Object.entries(mapping.columns).forEach(([field, columnId]) => {
    assertNonEmptyString(field, `columns.${field}.field`);
    if (!ALLOWED_MAPPED_FIELDS.has(field)) {
      throw new Error(`Invalid board mapping field: columns.${field}`);
    }
    assertNonEmptyString(columnId, `columns.${field}`);
    if (seenColumnIds.has(columnId)) {
      throw new Error(`Duplicate board mapping column id: ${columnId}`);
    }
    seenColumnIds.add(columnId);
  });

  return mapping;
}

function normalizeMappedValue(value, field, columnType) {
  if (columnType === "checkbox") {
    return { checked: Boolean(value) };
  }

  if (columnType === "date") {
    return value ? { date: String(value) } : null;
  }

  if (columnType === "link") {
    return value ? { url: String(value), text: field === "obituary_url" ? "View Obituary" : String(value) } : null;
  }

  if (columnType === "status") {
    return { label: titleizeValue(value) };
  }

  if (columnType === "numbers") {
    return value == null || value === "" ? null : Number(value);
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return value ?? "";
}

function mapLeadToMondayItemWithMapping(lead, mapping, boardColumns = []) {
  validateLead(lead);
  validateBoardMapping(mapping);

  const itemName = buildItemName(lead, mapping.item_name_strategy);
  const summary = {
    deceased_name: lead.deceased_name,
    owner_name: lead.owner_name,
    owner_id: lead.owner_id,
    property_address: formatPropertyAddress(lead.property),
    county: lead.property.county ?? "",
    acres: lead.property.acres,
    operator_name: lead.property.operator_name ?? "",
    death_date: lead.obituary.death_date ?? "",
    obituary_source: lead.obituary.source_id,
    obituary_url: lead.obituary.url,
    match_score: lead.match.score,
    match_status: lead.match.status,
    tier: lead.tier,
    heir_count: lead.heirs.length,
    heirs_formatted: formatHeirs(lead.heirs),
    out_of_state_heir_likely: lead.out_of_state_heir_likely,
    out_of_state_states: lead.out_of_state_states,
    executor_mentioned: lead.executor_mentioned,
    unexpected_death: lead.unexpected_death,
    tags: lead.tags,
    scan_id: lead.scan_id,
    source: lead.source,
  };
  const columnTypes = new Map((boardColumns ?? []).map((column) => [column.id, column.type]));

  const columnValues = Object.fromEntries(
    Object.entries(mapping.columns)
      .map(([field, columnId]) => {
        const normalizedValue = normalizeMappedValue(summary[field], field, columnTypes.get(columnId));
        if (normalizedValue == null || normalizedValue === "") {
          return null;
        }
        return [columnId, normalizedValue];
      })
      .filter(Boolean),
  );

  return {
    itemName,
    columnValues,
    summary,
  };
}

module.exports = {
  ALLOWED_ITEM_NAME_STRATEGIES,
  ALLOWED_MAPPED_FIELDS,
  getLeadSchemaPath,
  mapLeadToMondayItemWithMapping,
  validateBoardMapping,
  validateLead,
};
