import { startTransition, useEffect, useMemo, useState } from "react";

import MatchExplainabilityCard from "../components/MatchExplainabilityCard";
import { getRequiredServiceBaseUrl, resolveServiceBaseUrl } from "../runtimeConfig";

const INITIAL_FORM = {
  owner_limit: 1000,
  lookback_days: 7,
  reference_date: "",
  source_ids: "",
};

const DEFAULT_ITEM_NAME_STRATEGIES = [
  "deceased_name_county",
  "deceased_name_only",
  "deceased_name_address",
];

async function fetchJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? payload.errors?.[0]?.message ?? `Request failed for ${path}`);
  }

  return payload;
}

function splitCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

// Parse an owners CSV into [{owner_name, county, state}]. Accepts a header row
// with name/owner_name/owner/client, county, and state columns (case-insensitive).
function parseOwnersCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.toLowerCase());
  const nameIndex = headers.findIndex((header) => ["name", "owner_name", "owner", "client_name", "client"].includes(header));
  const countyIndex = headers.findIndex((header) => header === "county");
  const stateIndex = headers.findIndex((header) => header === "state");
  const owners = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const ownerName = (nameIndex >= 0 ? cells[nameIndex] : cells[0]) ?? "";
    if (!ownerName.trim()) continue;
    const owner = { owner_name: ownerName.trim() };
    if (countyIndex >= 0 && cells[countyIndex]) owner.county = cells[countyIndex];
    if (stateIndex >= 0 && cells[stateIndex]) owner.state = cells[stateIndex];
    owners.push(owner);
  }
  return owners;
}

function formatColumnSummary(mapping, lliFields = []) {
  const labelsByKey = Object.fromEntries(lliFields.map((field) => [field.key, field.label]));
  return Object.entries(mapping?.columns ?? {})
    .map(([field, columnId]) => `${labelsByKey[field] ?? field} -> ${columnId}`)
    .join(", ");
}

function parseSourceIds(rawValue) {
  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildInitialMappingDraft(mapping, lliFields = []) {
  const columns = {};
  const fieldKeys = lliFields.length > 0 ? lliFields.map((field) => field.key) : [];
  for (const field of fieldKeys) {
    columns[field] = mapping?.columns?.[field] ?? "";
  }

  Object.entries(mapping?.columns ?? {}).forEach(([field, value]) => {
    if (!(field in columns)) {
      columns[field] = value ?? "";
    }
  });

  return {
    item_name_strategy: mapping?.item_name_strategy ?? "deceased_name_county",
    columns,
  };
}

function getIssueTone(severity) {
  if (severity === "error") {
    return "validation-issue error";
  }
  if (severity === "warning") {
    return "validation-issue warning";
  }
  return "validation-issue info";
}

function formatIssueCount(summary) {
  const errors = summary?.error_count ?? 0;
  const warnings = summary?.warning_count ?? 0;
  return `${errors} error${errors === 1 ? "" : "s"} · ${warnings} warning${warnings === 1 ? "" : "s"}`;
}

function applySuggestionsToDraft(currentDraft, suggestions = []) {
  const nextDraft = {
    ...currentDraft,
    columns: {
      ...currentDraft.columns,
    },
  };

  for (const suggestion of suggestions) {
    if (suggestion?.action?.kind !== "set_mapping_column") {
      continue;
    }
    if (!suggestion.action.field || !suggestion.action.value) {
      continue;
    }

    nextDraft.columns[suggestion.action.field] = suggestion.action.value;
  }

  return nextDraft;
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "n/a";
  }
  return `${Number(value).toFixed(1)}%`;
}

function formatMatchedFields(fields = []) {
  if (!fields.length) {
    return "Not available";
  }
  return fields.join(", ");
}

function buildOwnerLink(lead) {
  return lead?.owner_profile_url ?? null;
}

function buildObituaryLink(lead) {
  return lead?.obituary_raw_url ?? lead?.obituary?.url ?? null;
}

function LeadConfidenceCard({ lead }) {
  if (!lead) {
    return <p>No scan result details yet.</p>;
  }

  const obituaryLink = buildObituaryLink(lead);
  const ownerLink = buildOwnerLink(lead);

  return (
    <div className="scan-result-card">
      <p className="lead-title">{lead.deceased_name}</p>
      <p>Owner: {lead.owner_name}</p>
      <p>Tier: {lead.tier}</p>
      <p>
        Confidence score: <strong>{formatPercent(lead.match?.score)}</strong>
      </p>
      <p>Match status: {lead.match?.status ?? "n/a"}</p>
      <p>Matched fields: {formatMatchedFields(lead.match?.matched_fields)}</p>
      {lead.match?.explanation?.length ? (
        <ul className="activity-list compact-list">
          {lead.match.explanation.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      <div className="result-links">
        {obituaryLink ? (
          <a href={obituaryLink} target="_blank" rel="noreferrer">
            View raw obituary
          </a>
        ) : null}
        {ownerLink ? (
          <a href={ownerLink} target="_blank" rel="noreferrer">
            View owner profile
          </a>
        ) : null}
      </div>
    </div>
  );
}

function MappingFieldCard({ field, value, onChange, crmFields }) {
  const recommendedTypes = field.recommended_types?.length ? field.recommended_types.join(", ") : "Any compatible text field";

  return (
    <article className={`mapping-field-card ${field.required ? "required" : ""}`}>
      <div className="mapping-field-card__header">
        <div>
          <div className="mapping-field-card__title-row">
            <h3>{field.label}</h3>
            {field.required ? <span className="pill pill-required">Recommended</span> : null}
          </div>
          <p className="mapping-field-key">{field.key}</p>
        </div>
      </div>
      <p className="mapping-field-description">{field.description}</p>
      <dl className="mapping-field-meta">
        <div>
          <dt>Example</dt>
          <dd>{field.example ?? "n/a"}</dd>
        </div>
        <div>
          <dt>Best source</dt>
          <dd>{field.source_hint ?? "n/a"}</dd>
        </div>
        <div>
          <dt>Preferred CRM field types</dt>
          <dd>{recommendedTypes}</dd>
        </div>
      </dl>
      <label>
        CRM field for {field.key}
        <select aria-label={`CRM field for ${field.key}`} value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
          <option value="">Not mapped</option>
          {crmFields.map((crmField) => (
            <option key={crmField.id} value={crmField.id}>
              {crmField.label} ({crmField.type})
            </option>
          ))}
        </select>
      </label>
    </article>
  );
}

export default function DashboardPage() {
  const [status, setStatus] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [mappingDraft, setMappingDraft] = useState(buildInitialMappingDraft(null, []));
  const [boards, setBoards] = useState([]);
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [validation, setValidation] = useState(null);
  const [fieldCatalog, setFieldCatalog] = useState({ crm_fields: [], lli_fields: [] });
  const [lastAppliedCorrectionDraft, setLastAppliedCorrectionDraft] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [loading, setLoading] = useState(true);
  const [runningScan, setRunningScan] = useState(false);
  const [savingBoard, setSavingBoard] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
  const [applyingCorrections, setApplyingCorrections] = useState(false);
  const [error, setError] = useState("");
  const [lastRunSummary, setLastRunSummary] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [pipelineMetrics, setPipelineMetrics] = useState(null);

  async function refreshDashboard() {
    setLoading(true);
    setError("");

    try {
      const crmAdapterBaseUrl = getRequiredServiceBaseUrl("crmAdapterBaseUrl");
      const [statusPayload, mappingResult, boardsResult, validationResult] = await Promise.allSettled([
        fetchJson(crmAdapterBaseUrl, "/status"),
        fetchJson(crmAdapterBaseUrl, "/mapping"),
        fetchJson(crmAdapterBaseUrl, "/boards"),
        fetchJson(crmAdapterBaseUrl, "/validation"),
      ]);

      if (statusPayload.status !== "fulfilled") {
        throw statusPayload.reason;
      }

      startTransition(() => {
        setStatus(statusPayload.value);
      });

      if (mappingResult.status === "fulfilled") {
        startTransition(() => {
          setMapping(mappingResult.value);
          setFieldCatalog(mappingResult.value.field_catalog ?? { crm_fields: [], lli_fields: [] });
          setMappingDraft(
            buildInitialMappingDraft(
              mappingResult.value.mapping,
              mappingResult.value.field_catalog?.lli_fields ?? [],
            ),
          );
          setLastAppliedCorrectionDraft(null);
        });
      } else {
        startTransition(() => {
          setMapping(null);
          setFieldCatalog({ crm_fields: [], lli_fields: [] });
          setMappingDraft(buildInitialMappingDraft(null, []));
          setLastAppliedCorrectionDraft(null);
        });
      }

      if (boardsResult.status === "fulfilled") {
        startTransition(() => {
          setBoards(boardsResult.value.boards ?? []);
          setSelectedBoardId(boardsResult.value.selected_board?.id ?? "");
        });
      } else {
        startTransition(() => {
          setBoards([]);
          setSelectedBoardId(statusPayload.value.board?.id ?? "");
        });
      }

      if (validationResult.status === "fulfilled") {
        startTransition(() => {
          setValidation(validationResult.value);
        });
      } else {
        startTransition(() => {
          setValidation(null);
        });
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshDashboard();
  }, []);

  // Pipeline metrics are best-effort and informational — fetched once on mount in
  // their own effect so a failure never affects the dashboard, and the per-refresh
  // fetch sequence stays unchanged.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const leadEngineBaseUrl = getRequiredServiceBaseUrl("leadEngineBaseUrl");
        const payload = await fetchJson(leadEngineBaseUrl, "/metrics");
        if (active) setPipelineMetrics(payload);
      } catch {
        if (active) setPipelineMetrics(null);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleRunScan(event) {
    event.preventDefault();
    if (!validation?.can_start_scan) {
      setError("Fix validator errors before running scan.");
      return;
    }

    setRunningScan(true);
    setError("");

    try {
      const leadEngineBaseUrl = getRequiredServiceBaseUrl("leadEngineBaseUrl");
      const result = await fetchJson(leadEngineBaseUrl, "/run-scan", {
        method: "POST",
        body: JSON.stringify({
          owner_limit: Number(form.owner_limit),
          lookback_days: Number(form.lookback_days),
          reference_date: form.reference_date || null,
          source_ids: parseSourceIds(form.source_ids),
        }),
      });

      startTransition(() => {
        setLastRunSummary(result);
      });
      await refreshDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setRunningScan(false);
    }
  }

  async function handleBoardSelect(event) {
    event.preventDefault();
    if (!selectedBoardId) {
      return;
    }

    setSavingBoard(true);
    setError("");
    try {
      const crmAdapterBaseUrl = getRequiredServiceBaseUrl("crmAdapterBaseUrl");
      const result = await fetchJson(crmAdapterBaseUrl, "/boards/select", {
        method: "POST",
        body: JSON.stringify({ board_id: selectedBoardId }),
      });
      startTransition(() => {
        setValidation(result.validation ?? null);
      });
      await refreshDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingBoard(false);
    }
  }

  async function handleImportOwners(event) {
    event.preventDefault();
    const file = event.target.elements.ownersCsv?.files?.[0];
    if (!file) {
      setError("Choose a CSV file of owners first.");
      return;
    }
    setImporting(true);
    setError("");
    setImportResult(null);
    try {
      const owners = parseOwnersCsv(await file.text());
      if (owners.length === 0) {
        throw new Error("No owner rows found. Expected a header row with a name column (plus optional county, state).");
      }
      const crmAdapterBaseUrl = getRequiredServiceBaseUrl("crmAdapterBaseUrl");
      const result = await fetchJson(crmAdapterBaseUrl, "/owners/import", {
        method: "POST",
        body: JSON.stringify({ owners }),
      });
      setImportResult(result);
      await refreshDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setImporting(false);
    }
  }

  async function persistMappingDraft(nextDraft, options = {}) {
    const crmAdapterBaseUrl = getRequiredServiceBaseUrl("crmAdapterBaseUrl");
    const payload = {
      item_name_strategy: nextDraft.item_name_strategy,
      columns: Object.fromEntries(
        Object.entries(nextDraft.columns).filter(([, value]) => String(value ?? "").trim() !== ""),
      ),
    };
    const result = await fetchJson(crmAdapterBaseUrl, "/mapping", {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    startTransition(() => {
      setMapping(result);
      setMappingDraft(buildInitialMappingDraft(result.mapping, fieldCatalog.lli_fields ?? []));
      setValidation(result.validation ?? null);
      if (options.rememberPreviousDraft) {
        setLastAppliedCorrectionDraft(options.rememberPreviousDraft);
      } else if (!options.keepUndoState) {
        setLastAppliedCorrectionDraft(null);
      }
    });

    return result;
  }

  async function handleMappingSave(event) {
    event.preventDefault();
    setSavingMapping(true);
    setError("");

    try {
      await persistMappingDraft(mappingDraft);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingMapping(false);
    }
  }

  async function handleApplyConfidentCorrections() {
    const confidentSuggestions = (validation?.suggestions ?? []).filter(
      (suggestion) => suggestion.confidence === "high" && suggestion.action?.kind === "set_mapping_column",
    );

    if (confidentSuggestions.length === 0) {
      return;
    }

    setApplyingCorrections(true);
    setError("");

    const previousDraft = {
      ...mappingDraft,
      columns: {
        ...mappingDraft.columns,
      },
    };
    const correctedDraft = applySuggestionsToDraft(previousDraft, confidentSuggestions);

    try {
      await persistMappingDraft(correctedDraft, {
        rememberPreviousDraft: previousDraft,
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setApplyingCorrections(false);
    }
  }

  function handleUndoCorrections() {
    if (!lastAppliedCorrectionDraft) {
      return;
    }

    startTransition(() => {
      setMappingDraft(lastAppliedCorrectionDraft);
      setLastAppliedCorrectionDraft(null);
    });
  }

  const selectedBoard = status?.board?.name ?? "No destination board selected";
  const deliveryCount = status?.deliveries?.length ?? 0;
  const latestDelivery = status?.latest_delivery;
  const latestLeadSummary = latestDelivery?.summary ?? null;
  const confidentSuggestions = useMemo(
    () =>
      (validation?.suggestions ?? []).filter(
        (suggestion) => suggestion.confidence === "high" && suggestion.action?.kind === "set_mapping_column",
      ),
    [validation],
  );
  const scanBlocked = !validation?.can_start_scan;
  const latestLead = lastRunSummary?.leads?.[0] ?? null;
  const crmFields = fieldCatalog.crm_fields ?? [];
  const lliFields = fieldCatalog.lli_fields ?? [];
  const crmLinkBaseUrl = resolveServiceBaseUrl("crmAdapterBaseUrl");
  const mondayConnected = Boolean(validation?.capabilities?.token_present);
  const justConnected = useMemo(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("connected") === "1",
    [],
  );

  return (
    <main className="page dashboard-page">
      <section className="panel hero hero-grid">
        <div>
          <p className="eyebrow">lli-saas orchestration flow</p>
          <h1>Obituary intelligence cockpit.</h1>
          <p className="lede">
            Pull owner records from the Monday <strong>Clients</strong> board, run the
            obituary intelligence scan through <code>lead-engine</code>, and manage the
            richer delivery mapping for obituary, heir, and match signals.
          </p>
        </div>
        <div className="hero-metrics">
          <div className="metric-chip">
            <span>Destination board</span>
            <strong>{selectedBoard}</strong>
          </div>
          <div className="metric-chip">
            <span>Deliveries</span>
            <strong>{deliveryCount}</strong>
          </div>
          <div className="metric-chip">
            <span>Latest</span>
            <strong>{latestDelivery?.status ?? "awaiting first scan"}</strong>
          </div>
        </div>
      </section>

      {justConnected ? (
        <section className="panel success-panel">
          <p>✅ Monday.com connected. Import your owners below, then run a scan.</p>
        </section>
      ) : null}

      {!loading && !mondayConnected ? (
        <section className="panel connect-panel">
          <h2>Step 1 — Connect your Monday.com</h2>
          <p className="lede">
            Authorize LLI to read your owner board and deliver scored leads back into Monday.
            You only do this once.
          </p>
          <button
            type="button"
            onClick={() => {
              if (crmLinkBaseUrl) {
                window.location.href = `${crmLinkBaseUrl}/auth/login`;
              } else {
                setError("Portal is missing the CRM adapter URL; cannot start the Monday connection.");
              }
            }}
          >
            Connect Monday
          </button>
        </section>
      ) : null}

      {error ? (
        <section className="panel alert-panel">
          <h2>Action needed</h2>
          <p>{error}</p>
        </section>
      ) : null}

      <section className="panel">
        <h2>Import your owners</h2>
        <p className="lede">
          Upload a CSV of your landowners to create your Monday <strong>Clients</strong> board
          automatically — no manual data entry. Use a header row with a <code>name</code> column
          (plus optional <code>county</code> and <code>state</code> columns).
        </p>
        <form onSubmit={handleImportOwners} className="import-form">
          <input type="file" name="ownersCsv" accept=".csv,text/csv" />
          <button type="submit" disabled={importing}>
            {importing ? "Importing…" : "Import owners → Clients board"}
          </button>
        </form>
        {importResult ? (
          <p className="import-result">
            ✅ Created {importResult.owners_created} owner
            {importResult.owners_created === 1 ? "" : "s"} on the “{importResult.board_name}” board.
          </p>
        ) : null}
      </section>

      {pipelineMetrics?.daily?.length ? (
        <section className="panel">
          <h2>Pipeline metrics</h2>
          <p className="subtle">
            {pipelineMetrics.totals?.obituaries ?? 0} obituaries scanned over{" "}
            {pipelineMetrics.totals?.days_tracked ?? 0} days ·{" "}
            {pipelineMetrics.totals?.leads_delivered ?? 0} leads delivered
          </p>
          <ul className="metrics-list">
            {[...pipelineMetrics.daily]
              .slice(-7)
              .reverse()
              .map((day) => (
                <li key={day.date}>
                  <strong>{day.date}</strong>: {day.obituaries} obituaries
                  {day.kind === "backfill" ? " (est.)" : ""}
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <section className="grid dashboard-grid validation-grid">
        <article className="panel validation-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Monday.com guardrail</p>
              <h2>Pre-scan validator</h2>
            </div>
            <p className={`status ${validation?.ready ? "ready" : "offline"}`}>
              {loading ? "Loading" : validation?.ready ? "Ready for scan" : "Needs review"}
            </p>
          </div>

          <div className="validation-summary-row">
            <div>
              <strong>{formatIssueCount(validation?.summary)}</strong>
              <span>{validation?.preview ? "Preview only" : "Live configuration"}</span>
            </div>
            <div>
              <strong>{validation?.state?.mapping?.mapped_field_count ?? 0}</strong>
              <span>mapped fields</span>
            </div>
            <div>
              <strong>{validation?.state?.selected_board?.name ?? "No board"}</strong>
              <span>destination</span>
            </div>
          </div>

          <div className="capability-grid">
            <div className={`capability-chip ${validation?.capabilities?.token_present ? "good" : "bad"}`}>
              Token {validation?.capabilities?.token_present ? "present" : "missing"}
            </div>
            <div className={`capability-chip ${validation?.capabilities?.monday_api_reachable ? "good" : "bad"}`}>
              Monday API {validation?.capabilities?.monday_api_reachable ? "reachable" : "offline"}
            </div>
            <div className={`capability-chip ${validation?.capabilities?.source_board_readable ? "good" : "bad"}`}>
              Source board {validation?.capabilities?.source_board_readable ? "readable" : "blocked"}
            </div>
            <div
              className={`capability-chip ${validation?.capabilities?.destination_board_readable ? "good" : "bad"}`}
            >
              Destination board {validation?.capabilities?.destination_board_readable ? "readable" : "blocked"}
            </div>
          </div>

          {confidentSuggestions.length > 0 ? (
            <div className="correction-bar">
              <button type="button" onClick={handleApplyConfidentCorrections} disabled={applyingCorrections}>
                {applyingCorrections
                  ? "Applying fixes..."
                  : `Apply ${confidentSuggestions.length} confident fix${confidentSuggestions.length === 1 ? "" : "es"}`}
              </button>
              <p>
                High-confidence mapping corrections are safe to apply automatically and can still be reviewed.
              </p>
            </div>
          ) : null}

          <div className="validation-layout">
            <div>
              <h3>Issues</h3>
              <ul className="validation-list">
                {(validation?.issues ?? []).length > 0 ? (
                  validation.issues.map((issue) => (
                    <li key={`${issue.code}-${issue.field ?? issue.scope}-${issue.column_id ?? "none"}`} className={getIssueTone(issue.severity)}>
                      <strong>{issue.field ?? issue.scope}</strong>
                      <span>{issue.message}</span>
                    </li>
                  ))
                ) : (
                  <li className="validation-issue success">
                    <strong>No blocking issues</strong>
                    <span>Board access, credentials, and mapping all passed validation.</span>
                  </li>
                )}
              </ul>
            </div>

            <div>
              <h3>Suggested corrections</h3>
              <ul className="validation-list suggestion-list">
                {(validation?.suggestions ?? []).length > 0 ? (
                  validation.suggestions.map((suggestion) => (
                    <li key={suggestion.id} className="validation-issue suggestion">
                      <strong>
                        {suggestion.field ?? suggestion.scope} · {suggestion.confidence}
                      </strong>
                      <span>{suggestion.message}</span>
                    </li>
                  ))
                ) : (
                  <li className="validation-issue info">
                    <strong>No suggestions pending</strong>
                    <span>The current Monday configuration does not need automatic correction hints.</span>
                  </li>
                )}
              </ul>
            </div>
          </div>
        </article>
      </section>

      <section className="grid dashboard-grid">
        <article className="panel status-card">
          <h2>Connection status</h2>
          <p className={`status ${status?.board ? "ready" : "offline"}`}>
            {loading ? "Loading" : status?.board ? "Destination board connected" : "Destination board not selected"}
          </p>
          <p>Tenant: {status?.tenant_id ?? "pilot"}</p>
          <p>Selected destination board: {selectedBoard}</p>
          <p>Scan runs tracked: {status?.scan_runs?.length ?? 0}</p>
        </article>

        <article className="panel mapping-card">
          <h2>Lead delivery mapping</h2>
          <p className="status ready">{mapping?.mapping?.item_name_strategy ?? "Not configured"}</p>
          <p>{mapping ? formatColumnSummary(mapping.mapping, lliFields) : "Select a destination board to persist mapping."}</p>
        </article>

        <article className="panel scan-card">
          <h2>Run scan</h2>
          <form className="auth-form scan-form" onSubmit={handleRunScan}>
            <p className="subtle">
              Scans the last {form.lookback_days} days of Iowa obituaries against your owners and
              delivers matched leads to your board. The defaults work for most runs — just press the button.
            </p>
            <details className="advanced-options">
              <summary>Advanced options</summary>
              <label>
                Owner limit
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={form.owner_limit}
                  onChange={(event) => setForm((current) => ({ ...current, owner_limit: event.target.value }))}
                />
              </label>
              <label>
                Lookback days
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={form.lookback_days}
                  onChange={(event) => setForm((current) => ({ ...current, lookback_days: event.target.value }))}
                />
              </label>
              <label>
                Reference date
                <input
                  type="date"
                  value={form.reference_date}
                  onChange={(event) => setForm((current) => ({ ...current, reference_date: event.target.value }))}
                />
              </label>
              <label>
                Source ids
                <input
                  type="text"
                  placeholder="kwbg_boone, kcim_carroll"
                  value={form.source_ids}
                  onChange={(event) => setForm((current) => ({ ...current, source_ids: event.target.value }))}
                />
              </label>
            </details>
            <button type="submit" disabled={runningScan || scanBlocked}>
              {runningScan
                ? "Running scan..."
                : scanBlocked
                  ? "Fix validator errors before running scan"
                  : "Run obituary scan"}
            </button>
          </form>
          <p className="subtle">
            Each run pulls fresh owner data from Monday instead of scanning a persisted owner corpus.
          </p>
          {lastRunSummary ? (
            <div className="result-strip">
              <strong>{lastRunSummary.scan_id}</strong>
              <span>{lastRunSummary.owner_count} owners fetched</span>
              <span>{lastRunSummary.lead_count} leads generated</span>
              <span>{lastRunSummary.delivery_summary.created} delivered</span>
              <span>{lastRunSummary.delivery_summary.failed} failed</span>
            </div>
          ) : null}
        </article>
      </section>

      <section className="grid dashboard-grid">
        <article className="panel">
          <h2>Destination board</h2>
          <form className="auth-form" onSubmit={handleBoardSelect}>
            <label>
              Choose Monday board
              <select value={selectedBoardId} onChange={(event) => setSelectedBoardId(event.target.value)}>
                <option value="">Select a board</option>
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={savingBoard || !selectedBoardId}>
              {savingBoard ? "Saving board..." : "Save board"}
            </button>
          </form>
        </article>

        <article className="panel mapping-editor-card mapping-editor-card--full">
          <div className="section-heading">
            <div>
              <h2>Configurable owner field mapping</h2>
              <p className="subtle mapping-editor-subtitle">
                Match the broker&apos;s CRM fields to the LLI owner-data contract with descriptions and examples so onboarding stays repeatable.
              </p>
            </div>
            {lastAppliedCorrectionDraft ? (
              <button type="button" className="secondary-button" onClick={handleUndoCorrections}>
                Revert auto-fixes
              </button>
            ) : null}
          </div>
          <form className="auth-form mapping-form" onSubmit={handleMappingSave}>
            <label>
              Item name strategy
              <select
                value={mappingDraft.item_name_strategy}
                onChange={(event) =>
                  setMappingDraft((current) => ({ ...current, item_name_strategy: event.target.value }))
                }
              >
                {DEFAULT_ITEM_NAME_STRATEGIES.map((strategy) => (
                  <option key={strategy} value={strategy}>
                    {strategy}
                  </option>
                ))}
              </select>
            </label>

            <div className="mapping-catalog-layout">
              <section className="mapping-catalog-panel crm-catalog-panel">
                <div className="mapping-catalog-header">
                  <h3>Available CRM fields</h3>
                  <span>{crmFields.length} found</span>
                </div>
                <ul className="crm-field-list">
                  {crmFields.length > 0 ? (
                    crmFields.map((field) => (
                      <li key={field.id} className="crm-field-card">
                        <div className="crm-field-card__row">
                          <strong>{field.label}</strong>
                          <span className="pill">{field.type}</span>
                        </div>
                        <p className="crm-field-id">{field.id}</p>
                        <p>{field.description}</p>
                        {field.example ? <p className="crm-field-example">Example: {field.example}</p> : null}
                      </li>
                    ))
                  ) : (
                    <li className="crm-field-card empty-state">Select a destination board to load CRM fields.</li>
                  )}
                </ul>
              </section>

              <section className="mapping-catalog-panel lli-catalog-panel">
                <div className="mapping-catalog-header">
                  <h3>LLI required owner fields</h3>
                  <span>{lliFields.length} configurable</span>
                </div>
                <div className="mapping-grid mapping-grid-rich">
                  {lliFields.map((field) => (
                    <MappingFieldCard
                      key={field.key}
                      field={field}
                      value={mappingDraft.columns[field.key] ?? ""}
                      crmFields={crmFields}
                      onChange={(value) =>
                        setMappingDraft((current) => ({
                          ...current,
                          columns: {
                            ...current.columns,
                            [field.key]: value,
                          },
                        }))
                      }
                    />
                  ))}
                </div>
              </section>
            </div>
            <button type="submit" disabled={savingMapping}>
              {savingMapping ? "Saving mapping..." : "Save mapping"}
            </button>
          </form>
        </article>
      </section>

      <section className="grid dashboard-grid">
        <article className="panel lead-card">
          <h2>Recent delivery</h2>
          {latestDelivery ? (
            <>
              <p className="lead-title">{latestDelivery.item_name}</p>
              <p>Status: {latestDelivery.status}</p>
              <p>Scan: {latestDelivery.scan_id}</p>
              {latestLeadSummary ? (
                <>
                  <p>Tier: {latestLeadSummary.tier ?? "n/a"}</p>
                  <p>Match score: {latestLeadSummary.match_score ?? "n/a"}</p>
                  <p>Heirs: {latestLeadSummary.heir_count ?? 0}</p>
                </>
              ) : null}
            </>
          ) : (
            <p>No delivery records yet.</p>
          )}
        </article>

        <article className="panel history-card">
          <h2>Delivery history</h2>
          <ul className="activity-list">
            {(status?.deliveries ?? []).slice(0, 4).map((delivery) => (
              <li key={delivery.id}>
                <strong>{delivery.item_name}</strong>
                <span>{delivery.status}</span>
                <span>{delivery.summary?.tier ?? "tier unavailable"}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel history-card">
          <h2>Scan runs</h2>
          <ul className="activity-list">
            {(status?.scan_runs ?? []).slice(0, 4).map((scanRun) => (
              <li key={scanRun.scan_id}>
                <strong>{scanRun.scan_id}</strong>
                <span>{scanRun.last_delivery_status}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="grid dashboard-grid">
        <article className="panel history-card">
          <h2>Latest scan confidence</h2>
          <LeadConfidenceCard lead={latestLead} />
        </article>

        <article className="panel explainability-card-panel explainability-card-panel--full">
          <h2>Match Explainability</h2>
          <MatchExplainabilityCard lead={latestLead} />
        </article>
      </section>
    </main>
  );
}
