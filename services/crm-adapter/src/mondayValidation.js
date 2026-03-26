const REQUIRED_BOARD_FIELDS = ["owner_name", "obituary_url", "tier"];
const REQUIRED_FIELD_LABELS = {
  owner_name: "Owner Name",
  obituary_url: "Obituary URL",
  tier: "Tier",
};

function normalizeLookupValue(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findBoardColumnById(columns, columnId) {
  return (columns ?? []).find((column) => String(column.id) === String(columnId));
}

function buildBoardValidation({ board, mapping }) {
  const issues = [];
  const field_results = [];

  for (const field of REQUIRED_BOARD_FIELDS) {
    const columnId = mapping?.columns?.[field] ?? "";
    const column = columnId ? findBoardColumnById(board?.columns, columnId) : null;
    const label = REQUIRED_FIELD_LABELS[field] ?? field;

    if (!columnId) {
      field_results.push({
        field,
        label,
        status: "missing_mapping",
        message: `${label} is not mapped to a Monday column.`,
        guidance: `Map ${label} to a Monday column before running a scan.`,
      });
      issues.push({
        code: "missing_required_mapping",
        field,
        severity: "error",
        message: `${label} is not mapped to a Monday column.`,
        guidance: `Open board mapping and assign a destination column for ${label}.`,
      });
      continue;
    }

    if (!column) {
      field_results.push({
        field,
        label,
        status: "missing_column",
        column_id: columnId,
        message: `${label} is mapped to ${columnId}, but that column does not exist on the selected board.`,
        guidance: `Choose an existing Monday column for ${label} or update the board schema.`,
      });
      issues.push({
        code: "mapped_column_missing",
        field,
        column_id: columnId,
        severity: "error",
        message: `${label} is mapped to ${columnId}, but that column does not exist on the selected board.`,
        guidance: `Refresh the board schema and update the ${label} mapping.`,
      });
      continue;
    }

    field_results.push({
      field,
      label,
      status: "valid",
      column_id: String(column.id),
      column_title: column.title,
      column_type: column.type,
      message: `${label} is mapped to ${column.title}.`,
    });
  }

  return {
    ok: issues.length === 0,
    required_fields: REQUIRED_BOARD_FIELDS,
    field_results,
    issues,
  };
}

function buildTokenValidation({ tokenPresent, oauthConfigured, tokenCheckResult }) {
  const issues = [];
  let status = "valid";
  let message = "Monday OAuth token is valid.";
  let guidance = null;

  if (!oauthConfigured) {
    status = "missing_oauth_configuration";
    message = "Monday OAuth client configuration is incomplete.";
    guidance = "Set MONDAY_CLIENT_ID, MONDAY_CLIENT_SECRET, and MONDAY_REDIRECT_URI before running scans.";
    issues.push({
      code: "oauth_configuration_incomplete",
      severity: "error",
      message,
      guidance,
    });
  } else if (!tokenPresent) {
    status = "missing_token";
    message = "Monday OAuth token is not connected for this tenant.";
    guidance = "Reconnect Monday in the operator setup flow before running a scan.";
    issues.push({
      code: "oauth_token_missing",
      severity: "error",
      message,
      guidance,
    });
  } else if (!tokenCheckResult?.ok) {
    status = tokenCheckResult?.status ?? "invalid";
    message = tokenCheckResult?.message ?? "Monday OAuth token validation failed.";
    guidance = tokenCheckResult?.guidance ?? "Reconnect Monday and try validation again.";
    issues.push({
      code: tokenCheckResult?.code ?? "oauth_token_invalid",
      severity: tokenCheckResult?.severity ?? "error",
      message,
      guidance,
      details: tokenCheckResult?.details ?? {},
    });
  }

  return {
    ok: issues.length === 0,
    status,
    message,
    guidance,
    checked_at: new Date().toISOString(),
    issues,
  };
}

function summarizeValidation({ tokenValidation, boardValidation, boardSelected }) {
  const issues = [
    ...(tokenValidation?.issues ?? []),
    ...(boardValidation?.issues ?? []),
  ];

  if (!boardSelected) {
    issues.unshift({
      code: "board_not_selected",
      severity: "error",
      message: "No Monday destination board is selected.",
      guidance: "Select a Monday board before running a scan.",
    });
  }

  return {
    ready: issues.length === 0,
    status: issues.length === 0 ? "ready" : "action_required",
    issues,
  };
}

module.exports = {
  REQUIRED_BOARD_FIELDS,
  REQUIRED_FIELD_LABELS,
  buildBoardValidation,
  buildTokenValidation,
  summarizeValidation,
  normalizeLookupValue,
};
