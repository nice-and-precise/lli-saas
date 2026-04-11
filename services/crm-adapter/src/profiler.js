const { DEFAULT_PROFILING_CONFIG } = require("./profilingConfig");

const STATE_CODE_REGEX = /^[A-Z]{2}$/;
const POSTAL_CODE_REGEX = /^\d{5}(?:-\d{4})?$/;

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .sort();
}

function normalizeFieldValue(field, value) {
  if (Array.isArray(value)) {
    return normalizeArray(value).join("|");
  }

  if (field === "state" || field === "mailing_state") {
    return String(value ?? "").trim().toUpperCase();
  }

  if (field === "mailing_postal_code" || field === "property_postal_code") {
    return String(value ?? "")
      .trim()
      .replace(/[^0-9-]/g, "");
  }

  return normalizeText(value);
}

function isMissing(value) {
  if (value == null) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim() === "";
  }

  if (Array.isArray(value)) {
    return value.length === 0 || value.every((item) => String(item ?? "").trim() === "");
  }

  return false;
}

function issueId(prefix, index, suffix) {
  return `${prefix}-${index}-${suffix}`;
}

function createIssue({
  id,
  severity,
  code,
  message,
  recordIndex = null,
  ownerId = null,
  field = null,
  ruleId = null,
  value = null,
  meta = {},
}) {
  return {
    id,
    severity,
    code,
    message,
    record_index: recordIndex,
    owner_id: ownerId,
    field,
    rule_id: ruleId,
    value,
    meta,
  };
}

function severityToLevel(severity) {
  if (severity === "blocker") {
    return "blocker";
  }

  if (severity === "warning") {
    return "warning";
  }

  return "info";
}

function summarizeIssues(issues) {
  return issues.reduce(
    (summary, issue) => {
      if (issue.severity === "blocker") {
        summary.blocker_count += 1;
      } else if (issue.severity === "warning") {
        summary.warning_count += 1;
      } else {
        summary.info_count += 1;
      }
      return summary;
    },
    { blocker_count: 0, warning_count: 0, info_count: 0 },
  );
}

function summarizeFieldCoverage(records, fields) {
  const result = {};

  Object.keys(fields).forEach((field) => {
    let present = 0;
    for (const record of records) {
      if (!isMissing(record?.[field])) {
        present += 1;
      }
    }

    result[field] = {
      present_count: present,
      missing_count: records.length - present,
      completion_rate: records.length === 0 ? 1 : Number((present / records.length).toFixed(4)),
      severity: fields[field].severity,
      required: Boolean(fields[field].required),
    };
  });

  return result;
}

function checkFieldRule({ record, field, config, recordIndex }) {
  const issues = [];
  const value = record?.[field];
  const ownerId = record?.owner_id ?? null;
  const severity = severityToLevel(config.severity);

  for (const check of config.checks ?? []) {
    if (check === "non_empty") {
      if (config.required && isMissing(value)) {
        issues.push(
          createIssue({
            id: issueId("field", recordIndex, `${field}-required`),
            severity,
            code: "missing_required_field",
            message: `${field} is required for LLI matching readiness`,
            recordIndex,
            ownerId,
            field,
            ruleId: `${field}:non_empty`,
          }),
        );
      } else if (!config.required && isMissing(value)) {
        issues.push(
          createIssue({
            id: issueId("field", recordIndex, `${field}-missing`),
            severity,
            code: "missing_recommended_field",
            message: `${field} is missing; brokers should review before matching`,
            recordIndex,
            ownerId,
            field,
            ruleId: `${field}:non_empty`,
          }),
        );
      }
    }

    if (isMissing(value)) {
      continue;
    }

    if (check === "state_code" && !STATE_CODE_REGEX.test(String(value).trim().toUpperCase())) {
      issues.push(
        createIssue({
          id: issueId("field", recordIndex, `${field}-format`),
          severity,
          code: "invalid_format",
          message: `${field} should be a two-letter state code`,
          recordIndex,
          ownerId,
          field,
          ruleId: `${field}:state_code`,
          value,
        }),
      );
    }

    if (check === "postal_code" && !POSTAL_CODE_REGEX.test(String(value).trim())) {
      issues.push(
        createIssue({
          id: issueId("field", recordIndex, `${field}-postal`),
          severity,
          code: "invalid_format",
          message: `${field} should use ZIP or ZIP+4 format`,
          recordIndex,
          ownerId,
          field,
          ruleId: `${field}:postal_code`,
          value,
        }),
      );
    }

    if (check === "numeric_non_negative") {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue) || numericValue < 0) {
        issues.push(
          createIssue({
            id: issueId("field", recordIndex, `${field}-numeric`),
            severity,
            code: "invalid_format",
            message: `${field} should be a non-negative number`,
            recordIndex,
            ownerId,
            field,
            ruleId: `${field}:numeric_non_negative`,
            value,
          }),
        );
      }
    }

    if (check === "array_non_empty" && (!Array.isArray(value) || value.length === 0)) {
      issues.push(
        createIssue({
          id: issueId("field", recordIndex, `${field}-array`),
          severity,
          code: "missing_required_field",
          message: `${field} must include at least one value`,
          recordIndex,
          ownerId,
          field,
          ruleId: `${field}:array_non_empty`,
          value,
        }),
      );
    }
  }

  return issues;
}

function checkCrossFieldRules(records, config) {
  const issues = [];

  records.forEach((record, recordIndex) => {
    for (const rule of config.crossFieldRules ?? []) {
      const hasNeededFields = (rule.whenFieldsPresent ?? []).every((field) => !isMissing(record?.[field]));
      if (!hasNeededFields) {
        continue;
      }

      if (rule.check === "state_consistency") {
        const propertyState = normalizeFieldValue("state", record.state);
        const mailingState = normalizeFieldValue("mailing_state", record.mailing_state);
        if (propertyState && mailingState && propertyState !== mailingState) {
          issues.push(
            createIssue({
              id: issueId("cross", recordIndex, rule.id),
              severity: severityToLevel(rule.severity),
              code: "cross_field_inconsistency",
              message: "mailing_state does not match property state; confirm the owner mailing address is expected",
              recordIndex,
              ownerId: record.owner_id ?? null,
              field: "mailing_state",
              ruleId: rule.id,
              meta: {
                state: record.state,
                mailing_state: record.mailing_state,
              },
            }),
          );
        }
      }

      if (rule.check === "property_zip_requires_city") {
        if (isMissing(record.property_city)) {
          issues.push(
            createIssue({
              id: issueId("cross", recordIndex, rule.id),
              severity: severityToLevel(rule.severity),
              code: "cross_field_inconsistency",
              message: "property_city is recommended when property_postal_code is present",
              recordIndex,
              ownerId: record.owner_id ?? null,
              field: "property_city",
              ruleId: rule.id,
            }),
          );
        }
      }
    }
  });

  return issues;
}

function buildExactDuplicateKey(record, fields) {
  const parts = fields.map((field) => normalizeFieldValue(field, record?.[field]));
  if (parts.some((part) => !part)) {
    return null;
  }

  return parts.join("::");
}

function findExactDuplicates(records, config) {
  const issues = [];

  for (const rule of config.duplicateRules?.exact ?? []) {
    const groups = new Map();

    records.forEach((record, recordIndex) => {
      const key = buildExactDuplicateKey(record, rule.fields);
      if (!key) {
        return;
      }

      const current = groups.get(key) ?? [];
      current.push({ record, recordIndex });
      groups.set(key, current);
    });

    for (const [key, matches] of groups.entries()) {
      if (matches.length < 2) {
        continue;
      }

      const indices = matches.map((match) => match.recordIndex);
      const ownerIds = matches.map((match) => match.record.owner_id ?? null);

      matches.forEach(({ record, recordIndex }) => {
        issues.push(
          createIssue({
            id: issueId("duplicate", recordIndex, rule.id),
            severity: severityToLevel(rule.severity),
            code: "duplicate_candidate_exact",
            message: `Record appears in an exact duplicate group for ${rule.fields.join(", ")}`,
            recordIndex,
            ownerId: record.owner_id ?? null,
            ruleId: rule.id,
            meta: {
              duplicate_key: key,
              matched_record_indices: indices.filter((index) => index !== recordIndex),
              matched_owner_ids: ownerIds.filter((ownerId) => ownerId && ownerId !== record.owner_id),
              fields: rule.fields,
            },
          }),
        );
      });
    }
  }

  return issues;
}

function tokenizeForFuzzy(record, fields) {
  return new Set(
    fields
      .flatMap((field) => normalizeFieldValue(field, record?.[field]).split(/\s+|\|/))
      .map((token) => token.trim())
      .filter(Boolean),
  );
}

function jaccardSimilarity(left, right) {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function findFuzzyDuplicates(records, config) {
  const rule = config.duplicateRules?.fuzzy;
  if (!rule) {
    return [];
  }

  const issues = [];
  const threshold = Number(config.duplicateMatching?.fuzzyThreshold ?? 0.92);
  const maxCandidatesPerRecord = Number(config.duplicateMatching?.maxCandidatesPerRecord ?? 5);
  const candidateMap = new Map();

  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const leftTokens = tokenizeForFuzzy(records[leftIndex], rule.fields);
      const rightTokens = tokenizeForFuzzy(records[rightIndex], rule.fields);
      const score = jaccardSimilarity(leftTokens, rightTokens);

      if (score < threshold) {
        continue;
      }

      const leftMatches = candidateMap.get(leftIndex) ?? [];
      leftMatches.push({ record_index: rightIndex, owner_id: records[rightIndex].owner_id ?? null, score });
      candidateMap.set(leftIndex, leftMatches);

      const rightMatches = candidateMap.get(rightIndex) ?? [];
      rightMatches.push({ record_index: leftIndex, owner_id: records[leftIndex].owner_id ?? null, score });
      candidateMap.set(rightIndex, rightMatches);
    }
  }

  for (const [recordIndex, matches] of candidateMap.entries()) {
    const record = records[recordIndex];
    const topMatches = matches.sort((a, b) => b.score - a.score).slice(0, maxCandidatesPerRecord);
    issues.push(
      createIssue({
        id: issueId("duplicate", recordIndex, rule.id),
        severity: severityToLevel(rule.severity),
        code: "duplicate_candidate_fuzzy",
        message: "Record has lightweight fuzzy duplicate candidates that should be reviewed before matching",
        recordIndex,
        ownerId: record.owner_id ?? null,
        ruleId: rule.id,
        meta: {
          fields: rule.fields,
          candidates: topMatches,
        },
      }),
    );
  }

  return issues;
}

function createProfilingReport(records, options = {}) {
  const profilingConfig = options.config ?? DEFAULT_PROFILING_CONFIG;
  const datasetName = options.datasetName ?? "broker_owner_data";
  const issues = [];

  records.forEach((record, recordIndex) => {
    Object.entries(profilingConfig.fields).forEach(([field, fieldConfig]) => {
      issues.push(...checkFieldRule({ record, field, config: fieldConfig, recordIndex }));
    });
  });

  issues.push(...checkCrossFieldRules(records, profilingConfig));
  issues.push(...findExactDuplicates(records, profilingConfig));
  issues.push(...findFuzzyDuplicates(records, profilingConfig));

  const summary = summarizeIssues(issues);
  const readiness = summary.blocker_count > 0 ? "blocked" : summary.warning_count > 0 ? "review" : "ready";

  return {
    schema_version: "v1",
    dataset: {
      name: datasetName,
      record_count: records.length,
      profiled_at: new Date().toISOString(),
    },
    readiness,
    summary: {
      ...summary,
      issue_count: issues.length,
      exact_duplicate_count: issues.filter((issue) => issue.code === "duplicate_candidate_exact").length,
      fuzzy_duplicate_count: issues.filter((issue) => issue.code === "duplicate_candidate_fuzzy").length,
    },
    config: {
      version: profilingConfig.version,
      duplicate_matching: profilingConfig.duplicateMatching,
      field_count: Object.keys(profilingConfig.fields).length,
    },
    field_coverage: summarizeFieldCoverage(records, profilingConfig.fields),
    issues,
  };
}

module.exports = {
  DEFAULT_PROFILING_CONFIG,
  createProfilingReport,
  jaccardSimilarity,
  normalizeFieldValue,
  normalizeText,
};
