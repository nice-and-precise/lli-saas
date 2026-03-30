const fs = require("fs");
const path = require("path");
const { z } = require("zod");

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

const nonEmptyTrimmedString = z.string().trim().min(1);
const nullableString = z.string().nullable();
const nullableTrimmedString = z.string().trim().min(1).nullable();
const isoDateTimeString = z.string().datetime({ offset: true });
const isoDateString = z.string().date();

const heirRecordSchema = z
  .object({
    name: nonEmptyTrimmedString,
    relationship: nonEmptyTrimmedString,
    location_city: nullableString,
    location_state: nullableString,
    out_of_state: z.boolean(),
    phone: nullableString,
    email: nullableString,
    mailing_address: nullableString,
    executor: z.boolean(),
  })
  .strict();

const leadPropertySchema = z
  .object({
    county: nullableString,
    state: nullableString,
    acres: z.number().nullable(),
    parcel_ids: z.array(z.string()),
    address_line_1: nullableString,
    city: nullableString,
    postal_code: nullableString,
    operator_name: nullableString,
  })
  .strict();

const obituaryMetadataSchema = z
  .object({
    url: nonEmptyTrimmedString,
    source_id: nonEmptyTrimmedString,
    published_at: isoDateTimeString.nullable(),
    death_date: isoDateString.nullable(),
    deceased_city: nullableString,
    deceased_state: nullableString,
  })
  .strict();

const matchExplanationDetailSchema = z
  .object({
    component: nonEmptyTrimmedString,
    score: z.number(),
    weight: z.number(),
    matched: z.boolean(),
    evidence: nonEmptyTrimmedString,
  })
  .strict();

const matchMetadataSchema = z
  .object({
    score: z.number(),
    last_name_score: z.number(),
    first_name_score: z.number(),
    location_bonus_applied: z.boolean(),
    status: z.enum(["auto_confirmed", "pending_review"]),
    confidence_band: z.enum(["high", "medium", "low"]).nullable().optional(),
    matched_fields: z.array(z.string()).optional().default([]),
    explanation: z.array(z.string()).optional().default([]),
    explanation_details: z.array(matchExplanationDetailSchema).optional().default([]),
  })
  .strict();

const leadSchema = z
  .object({
    scan_id: nonEmptyTrimmedString,
    source: nonEmptyTrimmedString,
    run_started_at: isoDateTimeString,
    run_completed_at: isoDateTimeString,
    owner_id: nonEmptyTrimmedString,
    owner_name: nonEmptyTrimmedString,
    deceased_name: nonEmptyTrimmedString,
    property: leadPropertySchema,
    heirs: z.array(heirRecordSchema),
    obituary: obituaryMetadataSchema,
    match: matchMetadataSchema,
    tier: z.enum(["hot", "warm", "pending_review", "low_signal"]),
    out_of_state_heir_likely: z.boolean(),
    out_of_state_states: z.array(z.string()),
    executor_mentioned: z.boolean(),
    unexpected_death: z.boolean(),
    notes: z.array(z.string()),
    tags: z.array(z.string()),
    raw_artifacts: z.array(z.string()),
    owner_profile_url: nullableString.optional(),
    obituary_raw_url: nullableString.optional(),
  })
  .strict();

const boardMappingSchema = z
  .object({
    item_name_strategy: z.enum([
      "deceased_name_county",
      "deceased_name_only",
      "deceased_name_address",
    ]),
    columns: z.record(nonEmptyTrimmedString, nonEmptyTrimmedString),
  })
  .strict()
  .superRefine((mapping, ctx) => {
    const seenColumnIds = new Set();

    Object.entries(mapping.columns).forEach(([field, columnId]) => {
      if (!ALLOWED_MAPPED_FIELDS.has(field)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid board mapping field: columns.${field}`,
          path: ["columns", field],
        });
        return;
      }

      if (seenColumnIds.has(columnId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate board mapping column id: ${columnId}`,
          path: ["columns", field],
        });
        return;
      }

      seenColumnIds.add(columnId);
    });
  });

function getLeadSchemaPath() {
  const existingPath = LEAD_SCHEMA_PATH_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  return existingPath ?? LEAD_SCHEMA_PATH_CANDIDATES[0];
}

function formatZodError(prefix, error) {
  const firstIssue = error.issues?.[0];
  if (!firstIssue) {
    return prefix;
  }

  const pathText = firstIssue.path?.length ? firstIssue.path.join(".") : null;
  if (!pathText) {
    return `${prefix}: ${firstIssue.message}`;
  }

  if (firstIssue.message.startsWith("Invalid board mapping field:")) {
    return firstIssue.message;
  }

  return `${prefix}: ${pathText}`;
}

function validateLead(lead) {
  const result = leadSchema.safeParse(lead);
  if (!result.success) {
    throw new Error(formatZodError("Invalid lead field", result.error));
  }

  return result.data;
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
  const result = boardMappingSchema.safeParse(mapping);
  if (!result.success) {
    throw new Error(formatZodError("Invalid board mapping payload", result.error));
  }

  return result.data;
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
  const validatedLead = validateLead(lead);
  const validatedMapping = validateBoardMapping(mapping);

  const itemName = buildItemName(validatedLead, validatedMapping.item_name_strategy);
  const summary = {
    deceased_name: validatedLead.deceased_name,
    owner_name: validatedLead.owner_name,
    owner_id: validatedLead.owner_id,
    property_address: formatPropertyAddress(validatedLead.property),
    county: validatedLead.property.county ?? "",
    acres: validatedLead.property.acres,
    operator_name: validatedLead.property.operator_name ?? "",
    death_date: validatedLead.obituary.death_date ?? "",
    obituary_source: validatedLead.obituary.source_id,
    obituary_url: validatedLead.obituary.url,
    match_score: validatedLead.match.score,
    match_status: validatedLead.match.status,
    tier: validatedLead.tier,
    heir_count: validatedLead.heirs.length,
    heirs_formatted: formatHeirs(validatedLead.heirs),
    out_of_state_heir_likely: validatedLead.out_of_state_heir_likely,
    out_of_state_states: validatedLead.out_of_state_states,
    executor_mentioned: validatedLead.executor_mentioned,
    unexpected_death: validatedLead.unexpected_death,
    tags: validatedLead.tags,
    scan_id: validatedLead.scan_id,
    source: validatedLead.source,
  };
  const columnTypes = new Map((boardColumns ?? []).map((column) => [column.id, column.type]));

  const columnValues = Object.fromEntries(
    Object.entries(validatedMapping.columns)
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
  boardMappingSchema,
  getLeadSchemaPath,
  leadSchema,
  mapLeadToMondayItemWithMapping,
  validateBoardMapping,
  validateLead,
};
