const leadContract = require("./leadContract");
const { createDefaultMapping } = require("./tokenStore");

const ALLOWED_ITEM_NAME_STRATEGIES =
  leadContract.ALLOWED_ITEM_NAME_STRATEGIES ??
  new Set(["deceased_name_county", "deceased_name_only", "deceased_name_address"]);
const ALLOWED_MAPPED_FIELDS =
  leadContract.ALLOWED_MAPPED_FIELDS ??
  new Set([
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

const RECOMMENDED_FIELDS = [
  "deceased_name",
  "owner_name",
  "obituary_url",
  "match_score",
  "tier",
];

const FIELD_METADATA = {
  deceased_name: {
    label: "Deceased name",
    description: "Primary decedent name that appears in the obituary and becomes the anchor for the delivered lead.",
    example: "Pat Example",
    sourceHint: "Usually comes from a CRM person/contact full-name field or a normalized decedent name field.",
    aliases: ["deceased name", "decedent", "name"],
    recommendedTypes: ["text", "long_text", "name"],
  },
  owner_name: {
    label: "Owner name",
    description: "Current landowner or account name that LLI matched against the obituary.",
    example: "Pat Example Revocable Trust",
    sourceHint: "Map from the owner/contact/account name field brokers already maintain in their CRM.",
    aliases: ["owner name", "owner", "client name"],
    recommendedTypes: ["text", "long_text", "name"],
  },
  owner_id: {
    label: "Owner ID",
    description: "Stable identifier for the source owner record so downstream scans can reconcile and dedupe reliably.",
    example: "owner-12345",
    sourceHint: "Best sourced from the CRM's immutable record id, external id, or primary key field.",
    aliases: ["owner id", "client id", "record id"],
    recommendedTypes: ["text", "long_text"],
  },
  property_address: {
    label: "Property address",
    description: "Primary mailing or property address associated with the owner record.",
    example: "123 County Road, Boone, IA 50036",
    sourceHint: "Can come from a single address field or a CRM formula field that combines street, city, state, and zip.",
    aliases: ["property address", "address"],
    recommendedTypes: ["text", "long_text"],
  },
  county: {
    label: "County",
    description: "County used in LLI matching and routing, especially for rural parcel context.",
    example: "Boone",
    sourceHint: "Usually maps from county, parish, or market-area text/status fields.",
    aliases: ["county"],
    recommendedTypes: ["text", "status", "dropdown"],
  },
  acres: {
    label: "Acres",
    description: "Numeric acreage tied to the owner or parcel.",
    example: "120.5",
    sourceHint: "Use a numeric parcel acreage or owned-acres field when available.",
    aliases: ["acres", "acreage"],
    recommendedTypes: ["numbers"],
  },
  operator_name: {
    label: "Operator name",
    description: "Farm operator, tenant, or business actively working the land.",
    example: "Johnson Farms LLC",
    sourceHint: "Often lives in tenant, operator, or lessee fields in broker CRMs.",
    aliases: ["operator name", "tenant name", "operator"],
    recommendedTypes: ["text", "long_text"],
  },
  death_date: {
    label: "Death date",
    description: "Date of death extracted from the obituary or source record.",
    example: "2026-03-09",
    sourceHint: "If the CRM already stores obituary or probate metadata, map the normalized death-date field here.",
    aliases: ["death date", "date of death"],
    recommendedTypes: ["date"],
  },
  obituary_source: {
    label: "Obituary source",
    description: "Publisher or feed source where the obituary was found.",
    example: "The Gazette",
    sourceHint: "Useful when the broker tracks source publication, feed, or intake origin.",
    aliases: ["obituary source", "source"],
    recommendedTypes: ["text", "status", "dropdown"],
  },
  obituary_url: {
    label: "Obituary URL",
    description: "Canonical link back to the obituary page used for review and auditability.",
    example: "https://example.com/obituaries/pat-example",
    sourceHint: "Map from a URL/link field whenever the CRM stores direct source links.",
    aliases: ["obituary url", "obituary link", "obit url", "obit link", "obit"],
    recommendedTypes: ["link"],
  },
  match_score: {
    label: "Match score",
    description: "Numeric confidence score from the LLI obituary-to-owner match model.",
    example: "89",
    sourceHint: "Best stored in a numeric score field for sorting and filtering.",
    aliases: ["match score", "score"],
    recommendedTypes: ["numbers"],
  },
  match_status: {
    label: "Match status",
    description: "Workflow state for how confidently LLI matched the obituary to the owner.",
    example: "pending_review",
    sourceHint: "Usually a status/dropdown field so brokers can filter confirmed vs review-needed matches.",
    aliases: ["match status", "status"],
    recommendedTypes: ["status", "dropdown", "text"],
  },
  tier: {
    label: "Tier",
    description: "LLI priority tier for the resulting lead based on signal strength and urgency.",
    example: "hot",
    sourceHint: "Map to a priority, temperature, or lead-tier field if one exists.",
    aliases: ["tier", "priority", "lead tier"],
    recommendedTypes: ["status", "dropdown", "text"],
  },
  heir_count: {
    label: "Heir count",
    description: "Number of heirs identified in the obituary or related processing.",
    example: "3",
    sourceHint: "Use a numeric field so operators can quickly spot more complex estates.",
    aliases: ["heir count", "heirs"],
    recommendedTypes: ["numbers"],
  },
  heirs_formatted: {
    label: "Formatted heirs",
    description: "Readable summary of heirs, relationships, and any location clues.",
    example: "Alex Example (son) - Dallas, TX [OOS]",
    sourceHint: "Works best in a long-text notes or summary field.",
    aliases: ["heirs formatted", "heirs", "heir summary"],
    recommendedTypes: ["text", "long_text"],
  },
  out_of_state_heir_likely: {
    label: "Out-of-state heir likely",
    description: "Boolean-style signal showing whether likely heirs appear to be outside the property's state.",
    example: "true",
    sourceHint: "Good fit for checkbox or status fields used for quick triage.",
    aliases: ["out of state heir", "oos heir", "out of state"],
    recommendedTypes: ["checkbox", "status", "dropdown", "text"],
  },
  out_of_state_states: {
    label: "Out-of-state states",
    description: "State abbreviations or names associated with likely out-of-state heirs.",
    example: "TX, CO",
    sourceHint: "Use text or long-text fields if the CRM stores multiple values in one column.",
    aliases: ["out of state states", "states"],
    recommendedTypes: ["text", "long_text"],
  },
  executor_mentioned: {
    label: "Executor mentioned",
    description: "Indicates whether an executor, administrator, or estate representative appears in the obituary.",
    example: "false",
    sourceHint: "Useful in checkbox or status fields to support probate follow-up workflows.",
    aliases: ["executor mentioned", "executor"],
    recommendedTypes: ["checkbox", "status", "dropdown", "text"],
  },
  unexpected_death: {
    label: "Unexpected death",
    description: "Signal flag when obituary language suggests sudden or unexpected death circumstances.",
    example: "false",
    sourceHint: "Typically a checkbox or status field reserved for higher-sensitivity review workflows.",
    aliases: ["unexpected death"],
    recommendedTypes: ["checkbox", "status", "dropdown", "text"],
  },
  tags: {
    label: "Tags",
    description: "LLI-generated tags that summarize lead attributes and workflow hints.",
    example: "tier:pending_review, county:boone",
    sourceHint: "Map to label, tag, or long-text fields depending on CRM support.",
    aliases: ["tags", "labels"],
    recommendedTypes: ["text", "long_text", "dropdown"],
  },
  scan_id: {
    label: "Scan ID",
    description: "Identifier for the LLI scan run that produced the lead.",
    example: "scan-2026-03-11-001",
    sourceHint: "Helpful for audit trails, support debugging, and broker onboarding repeatability.",
    aliases: ["scan id", "run id"],
    recommendedTypes: ["text", "long_text"],
  },
  source: {
    label: "Lead source",
    description: "Pipeline or subsystem that generated the lead payload.",
    example: "obituary_intelligence_engine",
    sourceHint: "Map to any source/origin field brokers use for attribution.",
    aliases: ["lead source", "source"],
    recommendedTypes: ["text", "status", "dropdown"],
  },
};

function normalizeKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function buildIssue({
  severity,
  code,
  scope,
  message,
  field = null,
  columnId = null,
  suggestionIds = [],
}) {
  return {
    severity,
    code,
    scope,
    message,
    field,
    column_id: columnId,
    suggestion_ids: suggestionIds,
  };
}

function buildSuggestion({
  scope,
  field = null,
  boardId = null,
  message,
  confidence = "high",
  action,
}) {
  return {
    id: `${scope}-${field ?? boardId ?? "global"}-${action.kind}-${action.value}`,
    scope,
    field,
    board_id: boardId,
    message,
    confidence,
    action,
  };
}

function summarizeIssues(issues) {
  return issues.reduce(
    (summary, issue) => {
      if (issue.severity === "error") {
        summary.error_count += 1;
      } else if (issue.severity === "warning") {
        summary.warning_count += 1;
      } else {
        summary.info_count += 1;
      }
      return summary;
    },
    { error_count: 0, warning_count: 0, info_count: 0 },
  );
}

function classifyMondayAccessError(error) {
  const message = String(error?.message ?? "");
  const normalized = message.toLowerCase();

  if (
    normalized.includes("unauthorized") ||
    normalized.includes("not authenticated") ||
    normalized.includes("invalid token") ||
    normalized.includes("access denied")
  ) {
    return {
      code: "invalid_credentials",
      message: "The saved Monday connection is no longer authorized. Reconnect the account before running a scan.",
    };
  }

  if (normalized.includes("rate limit")) {
    return {
      code: "monday_rate_limited",
      message: "Monday.com rate limited validation checks. Wait a moment and try again.",
    };
  }

  return {
    code: "monday_request_failed",
    message: "Unable to verify the Monday.com workspace right now. Try again after the API is reachable.",
  };
}

function normalizeMappingInput(input, fallbackMapping = createDefaultMapping()) {
  const nextMapping = {
    item_name_strategy:
      typeof input?.item_name_strategy === "string" && input.item_name_strategy.trim() !== ""
        ? input.item_name_strategy.trim()
        : fallbackMapping.item_name_strategy,
    columns: {},
  };

  Object.entries(input?.columns ?? {}).forEach(([field, value]) => {
    if (typeof value === "string" && value.trim() !== "") {
      nextMapping.columns[field] = value.trim();
    }
  });

  return nextMapping;
}

function findMatchingBoard(boards, boardId) {
  if (!boardId) {
    return null;
  }

  return boards.find((board) => String(board.id) === String(boardId)) ?? null;
}

function findBestColumnSuggestion(field, boardColumns, currentColumnId = "") {
  const metadata = FIELD_METADATA[field] ?? {
    label: field,
    aliases: [field],
    recommendedTypes: [],
  };
  const normalizedAliases = [metadata.label, ...metadata.aliases].map(normalizeKey).filter(Boolean);
  const normalizedCurrentColumnId = normalizeKey(currentColumnId);

  const ranked = (boardColumns ?? [])
    .map((column) => {
      const normalizedTitle = normalizeKey(column.title);
      const normalizedId = normalizeKey(column.id);
      let score = 0;

      if (normalizedCurrentColumnId && normalizedCurrentColumnId === normalizedId) {
        score += 6;
      }
      if (normalizedCurrentColumnId && normalizedCurrentColumnId === normalizedTitle) {
        score += 5;
      }
      if (normalizedAliases.includes(normalizedTitle)) {
        score += 5;
      }
      if (normalizedAliases.includes(normalizedId)) {
        score += 4;
      }
      if (normalizedAliases.some((alias) => alias && normalizedTitle.includes(alias))) {
        score += 3;
      }
      if (normalizedAliases.some((alias) => alias && normalizedId.includes(alias))) {
        score += 2;
      }
      if ((metadata.recommendedTypes ?? []).includes(column.type)) {
        score += 1;
      }

      return {
        column,
        score,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  const bestMatch = ranked[0];
  if (!bestMatch || bestMatch.score < 4) {
    return null;
  }

  return buildSuggestion({
    scope: "mapping",
    field,
    message: `Use board column "${bestMatch.column.title}" (${bestMatch.column.id}) for ${metadata.label.toLowerCase()}.`,
    confidence: bestMatch.score >= 6 ? "high" : "medium",
    action: {
      kind: "set_mapping_column",
      field,
      value: bestMatch.column.id,
    },
  });
}

function validateMappingStructure(mapping, boardColumns) {
  const issues = [];
  const suggestions = [];
  const seenColumns = new Map();
  const columnsById = new Map((boardColumns ?? []).map((column) => [String(column.id), column]));
  const mappedFields = Object.keys(mapping.columns ?? {});

  if (!ALLOWED_ITEM_NAME_STRATEGIES.has(mapping.item_name_strategy)) {
    issues.push(
      buildIssue({
        severity: "error",
        code: "invalid_item_name_strategy",
        scope: "mapping",
        message: `Item name strategy "${mapping.item_name_strategy}" is not supported.`,
      }),
    );
  }

  if (mappedFields.length === 0) {
    issues.push(
      buildIssue({
        severity: "warning",
        code: "mapping_empty",
        scope: "mapping",
        message:
          "No Monday fields are mapped yet. Scans can still create item names, but operators will miss lead details on the destination board.",
      }),
    );
  }

  Object.entries(mapping.columns ?? {}).forEach(([field, columnId]) => {
    if (!ALLOWED_MAPPED_FIELDS.has(field)) {
      issues.push(
        buildIssue({
          severity: "error",
          code: "invalid_mapping_field",
          scope: "mapping",
          field,
          columnId,
          message: `Field "${field}" is not a supported lead mapping.`,
        }),
      );
      return;
    }

    if (seenColumns.has(columnId)) {
      issues.push(
        buildIssue({
          severity: "error",
          code: "duplicate_mapping_column",
          scope: "mapping",
          field,
          columnId,
          message: `Column "${columnId}" is already mapped to "${seenColumns.get(columnId)}".`,
        }),
      );
      return;
    }
    seenColumns.set(columnId, field);

    const boardColumn = columnsById.get(columnId);
    if (!boardColumn) {
      const suggestion = findBestColumnSuggestion(field, boardColumns, columnId);
      if (suggestion) {
        suggestions.push(suggestion);
      }
      issues.push(
        buildIssue({
          severity: "error",
          code: "mapped_column_missing",
          scope: "mapping",
          field,
          columnId,
          message: `Mapped column "${columnId}" for ${FIELD_METADATA[field]?.label.toLowerCase() ?? field} does not exist on the selected board.`,
          suggestionIds: suggestion ? [suggestion.id] : [],
        }),
      );
      return;
    }

    const recommendedTypes = FIELD_METADATA[field]?.recommendedTypes ?? [];
    if (recommendedTypes.length > 0 && !recommendedTypes.includes(boardColumn.type)) {
      issues.push(
        buildIssue({
          severity: "warning",
          code: "mapped_column_type_mismatch",
          scope: "mapping",
          field,
          columnId,
          message: `Column "${boardColumn.title}" uses type "${boardColumn.type}", but ${FIELD_METADATA[field]?.label.toLowerCase() ?? field} works best with ${recommendedTypes.join(", ")} columns.`,
        }),
      );
    }
  });

  RECOMMENDED_FIELDS.forEach((field) => {
    if (mapping.columns?.[field]) {
      return;
    }

    const suggestion = findBestColumnSuggestion(field, boardColumns);
    if (suggestion) {
      suggestions.push(suggestion);
      issues.push(
        buildIssue({
          severity: "warning",
          code: "recommended_mapping_missing",
          scope: "mapping",
          field,
          message: `Consider mapping ${FIELD_METADATA[field]?.label.toLowerCase() ?? field} before the next scan.`,
          suggestionIds: [suggestion.id],
        }),
      );
    }
  });

  return {
    issues,
    suggestions,
  };
}

async function validateMondaySetup({
  mondayClient,
  mondayConfig,
  state,
  sourceBoardName,
}) {
  const issues = [];
  const suggestions = [];
  const capabilities = {
    oauth_app_configured: Object.values(mondayConfig).every(Boolean),
    token_present: Boolean(state.tokens?.monday_access_token),
    monday_api_reachable: null,
    source_board_readable: null,
    destination_board_readable: null,
    destination_board_write: "not_tested",
  };
  const token = state.tokens?.monday_access_token ?? null;
  const responseState = {
    source_board: null,
    selected_board: state.board ?? null,
    mapping: {
      item_name_strategy: state.board_mapping?.item_name_strategy ?? createDefaultMapping().item_name_strategy,
      mapped_field_count: Object.keys(state.board_mapping?.columns ?? {}).length,
    },
  };

  if (!token) {
    issues.push(
      buildIssue({
        severity: "error",
        code: "token_missing",
        scope: "credentials",
        message: "Connect Monday.com before running a scan. No access token is stored for this tenant.",
      }),
    );
    if (!capabilities.oauth_app_configured) {
      issues.push(
        buildIssue({
          severity: "error",
          code: "oauth_app_missing",
          scope: "credentials",
          message: "The server-side Monday OAuth app is not fully configured, so operators cannot reconnect if the token expires.",
        }),
      );
    }
  }

  if (!token) {
    return {
      issues,
      suggestions,
      capabilities,
      responseState,
    };
  }

  let boards = [];
  try {
    boards = await mondayClient.listBoards(token);
    capabilities.monday_api_reachable = true;
  } catch (error) {
    capabilities.monday_api_reachable = false;
    const mondayFailure = classifyMondayAccessError(error);
    issues.push(
      buildIssue({
        severity: "error",
        code: mondayFailure.code,
        scope: "credentials",
        message: mondayFailure.message,
      }),
    );
    return {
      issues,
      suggestions,
      capabilities,
      responseState,
    };
  }

  const sourceBoard = boards.find((board) => String(board.name).trim() === sourceBoardName) ?? null;
  responseState.source_board = sourceBoard
    ? {
        id: String(sourceBoard.id),
        name: sourceBoard.name,
      }
    : null;

  if (!sourceBoard) {
    issues.push(
      buildIssue({
        severity: "error",
        code: "source_board_missing",
        scope: "source_board",
        message: `Monday board "${sourceBoardName}" is not available to the connected account.`,
      }),
    );
  } else {
    try {
      await mondayClient.listBoardItems({
        token,
        boardId: String(sourceBoard.id),
        limit: 1,
      });
      capabilities.source_board_readable = true;
    } catch (error) {
      capabilities.source_board_readable = false;
      issues.push(
        buildIssue({
          severity: "error",
          code: "source_board_unreadable",
          scope: "permissions",
          message: `The connected Monday account cannot read items from "${sourceBoardName}".`,
        }),
      );
    }
  }

  const selectedBoardId = state.board?.id ? String(state.board.id) : "";
  const selectedBoard = findMatchingBoard(boards, selectedBoardId);
  if (!selectedBoardId) {
    issues.push(
      buildIssue({
        severity: "error",
        code: "destination_board_missing",
        scope: "destination_board",
        message: "Select a destination Monday board before starting a scan.",
      }),
    );
    return {
      issues,
      suggestions,
      capabilities,
      responseState,
    };
  }

  if (!selectedBoard) {
    issues.push(
      buildIssue({
        severity: "error",
        code: "destination_board_not_found",
        scope: "destination_board",
        message: "The saved destination board is no longer available to the connected Monday account.",
      }),
    );
    return {
      issues,
      suggestions,
      capabilities,
      responseState,
    };
  }

  responseState.selected_board = {
    id: String(selectedBoard.id),
    name: selectedBoard.name,
    columns: selectedBoard.columns ?? [],
  };

  try {
    await mondayClient.listBoardItems({
      token,
      boardId: String(selectedBoard.id),
      limit: 1,
    });
    capabilities.destination_board_readable = true;
  } catch (error) {
    capabilities.destination_board_readable = false;
    issues.push(
      buildIssue({
        severity: "error",
        code: "destination_board_unreadable",
        scope: "permissions",
        message: `The connected Monday account cannot read items from destination board "${selectedBoard.name}".`,
      }),
    );
  }

  const mappingValidation = validateMappingStructure(
    state.board_mapping ?? createDefaultMapping(),
    selectedBoard.columns ?? [],
  );
  issues.push(...mappingValidation.issues);
  suggestions.push(...mappingValidation.suggestions);

  return {
    issues,
    suggestions,
    capabilities,
    responseState,
  };
}

function buildValidationResponse({
  tenantId,
  preview,
  issues,
  suggestions,
  capabilities,
  responseState,
}) {
  const summary = summarizeIssues(issues);

  return {
    tenant_id: tenantId,
    preview,
    validated_at: new Date().toISOString(),
    ready: summary.error_count === 0,
    can_start_scan: summary.error_count === 0,
    summary,
    capabilities,
    issues,
    suggestions,
    state: responseState,
  };
}

module.exports = {
  FIELD_METADATA,
  buildValidationResponse,
  normalizeMappingInput,
  validateMondaySetup,
};
