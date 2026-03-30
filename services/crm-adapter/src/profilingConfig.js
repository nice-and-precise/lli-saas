const DEFAULT_PROFILING_CONFIG = {
  version: "2026-03-30.1",
  duplicateMatching: {
    fuzzyThreshold: 0.92,
    maxCandidatesPerRecord: 5,
  },
  fields: {
    owner_id: {
      required: true,
      severity: "blocker",
      type: "string",
      checks: ["non_empty"],
    },
    owner_name: {
      required: true,
      severity: "blocker",
      type: "string",
      checks: ["non_empty"],
    },
    county: {
      required: true,
      severity: "blocker",
      type: "string",
      checks: ["non_empty"],
    },
    state: {
      required: true,
      severity: "blocker",
      type: "state",
      checks: ["non_empty", "state_code"],
    },
    acres: {
      required: false,
      severity: "warning",
      type: "number",
      checks: ["numeric_non_negative"],
    },
    parcel_ids: {
      required: true,
      severity: "blocker",
      type: "string_array",
      checks: ["array_non_empty"],
    },
    mailing_state: {
      required: true,
      severity: "warning",
      type: "state",
      checks: ["non_empty", "state_code"],
    },
    mailing_city: {
      required: false,
      severity: "warning",
      type: "string",
      checks: ["non_empty"],
    },
    mailing_postal_code: {
      required: false,
      severity: "warning",
      type: "postal_code",
      checks: ["postal_code"],
    },
    property_address_line_1: {
      required: false,
      severity: "warning",
      type: "string",
      checks: ["non_empty"],
    },
    property_city: {
      required: false,
      severity: "warning",
      type: "string",
      checks: ["non_empty"],
    },
    property_postal_code: {
      required: false,
      severity: "warning",
      type: "postal_code",
      checks: ["postal_code"],
    },
    operator_name: {
      required: false,
      severity: "info",
      type: "string",
      checks: ["non_empty"],
    },
    crm_source: {
      required: true,
      severity: "blocker",
      type: "string",
      checks: ["non_empty"],
    },
    raw_source_ref: {
      required: false,
      severity: "info",
      type: "string",
      checks: ["non_empty"],
    },
  },
  crossFieldRules: [
    {
      id: "mailing_and_property_state_mismatch",
      severity: "warning",
      whenFieldsPresent: ["state", "mailing_state"],
      check: "state_consistency",
    },
    {
      id: "property_zip_requires_city",
      severity: "warning",
      whenFieldsPresent: ["property_postal_code"],
      check: "property_zip_requires_city",
    },
  ],
  duplicateRules: {
    exact: [
      {
        id: "exact_owner_id",
        severity: "blocker",
        fields: ["owner_id"],
      },
      {
        id: "exact_owner_name_property_address",
        severity: "warning",
        fields: ["owner_name", "property_address_line_1"],
      },
      {
        id: "exact_owner_name_county_parcel",
        severity: "warning",
        fields: ["owner_name", "county", "parcel_ids"],
      },
    ],
    fuzzy: {
      id: "fuzzy_owner_name_property",
      severity: "warning",
      fields: ["owner_name", "property_address_line_1", "mailing_postal_code"],
    },
  },
};

module.exports = {
  DEFAULT_PROFILING_CONFIG,
};
