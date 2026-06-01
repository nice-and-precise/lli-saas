import { startTransition, useEffect, useMemo, useRef, useState } from "react";

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

// Guards the one-time auto-provision POST against double-fire (StrictMode double
// mount / overlapping refreshes) so we never create duplicate Monday boards.
let autoProvisionInFlight = false;

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

// Plain-language labels for the broker-facing surfaces (delivery rows, hero chip).
// The raw codes still flow to the backend; we only humanize what brokers read.
const DELIVERY_STATUS_LABELS = {
  created: "Delivered",
  skipped_duplicate: "Already in your board",
  failed: "Delivery failed",
  pending: "Pending",
};

const TIER_LABELS = {
  hot: "Hot lead",
  warm: "Warm lead",
  pending_review: "Needs review",
  low_signal: "Low match",
};

function humanize(value) {
  return value ? String(value).replace(/_/g, " ") : "—";
}

function humanizeDeliveryStatus(status) {
  return DELIVERY_STATUS_LABELS[status] ?? humanize(status);
}

function humanizeTier(tier) {
  return TIER_LABELS[tier] ?? humanize(tier);
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

// The single "what do I do next?" cue for the cockpit, derived from current
// state so the operator always has one clear next action (Codex UX principle).
export function describeNextStep({
  loading,
  mondayConnected,
  hasBoard,
  errorCount,
  canStartScan,
  deliveryCount,
}) {
  if (loading) return null;
  if (!mondayConnected) {
    return "Connect your Monday.com account using the button below — you only do this once.";
  }
  if (!hasBoard) {
    return "Import your owners (CSV) to create your Clients board, or pick a destination board below.";
  }
  if (errorCount > 0) {
    return `Resolve ${errorCount} mapping ${errorCount === 1 ? "issue" : "issues"} flagged by the pre-scan validator below.`;
  }
  if (canStartScan) {
    const ready = "You're set up — run a scan to deliver scored leads into Monday.";
    return deliveryCount > 0
      ? `${ready} ${deliveryCount} lead${deliveryCount === 1 ? "" : "s"} delivered so far.`
      : ready;
  }
  return "Finish the destination board and field mapping below so the validator can clear a scan.";
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
  // Progressive-disclosure sections are uncontrolled <details> (native toggling),
  // force-opened once via refs when there's something to act on — see the effect
  // below. Refs (not controlled `open`) avoid a React setState in the toggle
  // handler that could fire after unmount.
  const readinessDetailsRef = useRef(null);
  const setupDetailsRef = useRef(null);

  async function refreshDashboard(skipAutoProvision = false) {
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

      // Auto-onboarding: on the first connected load (Monday token present, not yet
      // auto-provisioned), run server-side setup — detect the owner board + build the
      // leads board + map fields — then reload once to render the set-up state.
      // Best-effort + gated by the server's marker, so it runs at most once per tenant;
      // the recursion guard prevents any loop. Failures never block the dashboard.
      const statusValue = statusPayload.value;
      if (
        !skipAutoProvision &&
        !autoProvisionInFlight &&
        statusValue?.token_present &&
        !statusValue?.onboarding?.auto_provisioned_at
      ) {
        // Module-level in-flight guard so a double-mount / overlapping refresh can't
        // fire the provision POST twice (which could create duplicate boards).
        autoProvisionInFlight = true;
        try {
          await fetchJson(crmAdapterBaseUrl, "/onboard/auto-provision", { method: "POST" });
          return await refreshDashboard(true);
        } catch (_onboardError) {
          console.warn("auto-provision failed; rendering un-provisioned state", _onboardError);
        } finally {
          autoProvisionInFlight = false;
        }
      }

      startTransition(() => {
        setStatus(statusValue);
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
          setSelectedBoardId(statusValue.board?.id ?? "");
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

  async function handleSourceBoardSelect(boardId) {
    if (!boardId) {
      return;
    }
    setError("");
    try {
      const crmAdapterBaseUrl = getRequiredServiceBaseUrl("crmAdapterBaseUrl");
      await fetchJson(crmAdapterBaseUrl, "/boards/select-source", {
        method: "POST",
        body: JSON.stringify({ board_id: boardId }),
      });
      await refreshDashboard(true);
    } catch (requestError) {
      setError(requestError.message);
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
  const sourceBoard = status?.source_board ?? null;
  const autoProvisioned = Boolean(status?.onboarding?.auto_provisioned_at);
  const deliveryCount = status?.deliveries?.length ?? 0;
  const latestDelivery = status?.latest_delivery;
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
  const nextStep = describeNextStep({
    loading,
    mondayConnected,
    hasBoard: Boolean(status?.board),
    errorCount: validation?.summary?.error_count ?? 0,
    canStartScan: Boolean(validation?.can_start_scan),
    deliveryCount,
  });
  const justConnected = useMemo(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("connected") === "1",
    [],
  );
  // Decide the initial expanded/collapsed state of Setup + readiness ONCE, after
  // the first fully-settled load (status + validation both present). Doing it once
  // — rather than re-deriving each render — avoids the transient where status or
  // validation is momentarily null (startTransition) and the section flickers open,
  // and leaves the sections user-controlled afterward (manual toggles persist).
  const disclosuresInitialized = useRef(false);
  useEffect(() => {
    if (disclosuresInitialized.current) return;
    if (loading || !status || !validation) return;
    disclosuresInitialized.current = true;
    // Setup opens only when something is genuinely unfinished; readiness opens only
    // when a scan is actually blocked (warnings alone stay summarized in the chip).
    if (setupDetailsRef.current) {
      setupDetailsRef.current.open = !mondayConnected || !status.board || scanBlocked;
    }
    if (readinessDetailsRef.current) {
      readinessDetailsRef.current.open = scanBlocked;
    }
  }, [loading, status, validation, mondayConnected, scanBlocked]);

  return (
    <main className="page dashboard-page" aria-label="Obituary intelligence dashboard">
      <section className="panel hero hero-grid">
        <div>
          <p className="eyebrow">Obituary lead pipeline</p>
          <h1>Obituary intelligence cockpit.</h1>
          <p className="lede">
            Find land-owner leads from recent Iowa obituaries and deliver them straight into
            your Monday board — in one click.
          </p>
          <p className="conn-line">
            <span className={`conn-pill ${mondayConnected ? "is-connected" : "is-disconnected"}`}>
              {loading ? "Checking connection…" : mondayConnected ? "● Connected to Monday" : "○ Not connected"}
            </span>
            {mondayConnected && status?.board ? (
              <span className="conn-dest">
                Leads go to <strong>{selectedBoard}</strong>
              </span>
            ) : null}
          </p>
        </div>
        <div className="hero-metrics">
          <div className="metric-chip">
            <span>Obituaries scanned</span>
            <strong>{pipelineMetrics?.totals?.obituaries ?? "—"}</strong>
          </div>
          <div className="metric-chip">
            <span>Leads delivered</span>
            <strong>{deliveryCount}</strong>
          </div>
          <div className="metric-chip">
            <span>Latest activity</span>
            <strong>{latestDelivery ? humanizeDeliveryStatus(latestDelivery.status) : "Awaiting first scan"}</strong>
          </div>
        </div>
      </section>

      {justConnected ? (
        <section className="panel success-panel" role="status">
          <p>
            ✅ Monday.com connected.{" "}
            {autoProvisioned && sourceBoard
              ? "We set everything up for you — detected your owner board, built your “Land Legacy Leads” board, and mapped the fields. Just run a scan."
              : autoProvisioned
                ? "We built your “Land Legacy Leads” board and mapped the fields. We couldn’t auto-detect a landowner board — import a CSV or pick one in Setup below."
                : "Open Setup below to import your owners, then run a scan."}
          </p>
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
        <section className="panel alert-panel" role="alert">
          <h2>Action needed</h2>
          <p>{error}</p>
        </section>
      ) : null}

      {nextStep ? (
        <section
          className="panel next-step-panel"
          role="status"
          aria-live="polite"
          aria-label="What to do next"
        >
          <p className="next-step">
            <span className="next-step__tag">Next step</span>
            {nextStep}
          </p>
        </section>
      ) : null}

      {/* ---- PRIMARY ACTION: run a scan ---- */}
      <section className="panel action-panel" aria-label="Run a scan">
        <h2>Run an obituary scan</h2>
        <p className="subtle action-help">
          Scans the last {form.lookback_days} days of Iowa obituaries against your owners and
          delivers matched leads to <strong>{selectedBoard}</strong>. The defaults work for
          most runs — just press the button.
        </p>
        <form className="scan-form" onSubmit={handleRunScan}>
          <button
            type="submit"
            className="primary-action-button"
            disabled={runningScan || scanBlocked}
          >
            {runningScan
              ? "Running scan..."
              : scanBlocked
                ? "Fix validator errors before running scan"
                : "Run obituary scan"}
          </button>
          <details className="advanced-options">
            <summary>Advanced options</summary>
            <div className="advanced-options-grid">
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
            </div>
          </details>
        </form>
        {lastRunSummary ? (
          <div className="result-strip">
            <strong>{lastRunSummary.scan_id}</strong>
            <span>{lastRunSummary.owner_count} owners scanned</span>
            <span>{lastRunSummary.lead_count} leads found</span>
            <span>{lastRunSummary.delivery_summary.created} delivered</span>
            <span>{lastRunSummary.delivery_summary.failed} failed</span>
          </div>
        ) : null}
      </section>

      {/* ---- READINESS: chip when clear, full validator when there's something to fix ---- */}
      <details className="panel readiness-panel" ref={readinessDetailsRef}>
        <summary className="readiness-summary">
          <span className={`readiness-chip ${scanBlocked ? "warn" : "ok"}`}>
            {loading ? "Checking setup…" : scanBlocked ? "Needs attention before scanning" : "✓ Ready to scan"}
          </span>
          <span className="readiness-counts">{formatIssueCount(validation?.summary)}</span>
        </summary>
        <div className="readiness-body">
          <p className="eyebrow">Monday.com guardrail</p>
          <h2>Pre-scan validator</h2>

          <div className="validation-summary-row">
            <div>
              <strong>{validation?.preview ? "Preview only" : "Live configuration"}</strong>
              <span>configuration</span>
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
        </div>
      </details>

      {/* ---- LATEST RESULTS: the payoff ---- */}
      <section className="panel results-panel" aria-label="Latest results">
        <h2>Latest results</h2>
        {deliveryCount > 0 || lastRunSummary ? (
          <>
            {deliveryCount > 0 ? (
              <ul className="results-list">
                {(status?.deliveries ?? []).slice(0, 5).map((delivery) => (
                  <li key={delivery.id} className="result-row">
                    <strong>{delivery.item_name}</strong>
                    <span className="result-row__meta">
                      {humanizeTier(delivery.summary?.tier)} · {humanizeDeliveryStatus(delivery.status)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {lastRunSummary ? (
              <details className="results-detail" open>
                <summary>Latest scan match detail</summary>
                <div className="results-detail-body">
                  <LeadConfidenceCard lead={latestLead} />
                  <MatchExplainabilityCard lead={latestLead} />
                </div>
              </details>
            ) : null}
          </>
        ) : (
          <p className="subtle">No leads delivered yet — run your first scan above to see matches here.</p>
        )}
      </section>

      {/* ---- SETUP & CONNECTIONS (set-up-once; collapsed when ready) ---- */}
      <details className="panel disclosure" ref={setupDetailsRef}>
        <summary className="disclosure-summary">
          <span className="disclosure-title">Setup &amp; connections</span>
          <span className="disclosure-hint">
            {mondayConnected && autoProvisioned && !scanBlocked
              ? "Already set up for you — open to change boards or field mapping"
              : "Finish connecting Monday and choosing where leads go"}
          </span>
        </summary>
        <div className="disclosure-body">
          {mondayConnected && autoProvisioned ? (
            <section className="setup-item" aria-label="Owner source board">
              <h3>Where your owners come from</h3>
              {sourceBoard ? (
                <p className="subtle">
                  Reading landowners from your <strong>{sourceBoard.name}</strong> board automatically —
                  no CSV needed. Wrong board? Pick another below.
                </p>
              ) : (
                <p className="subtle">
                  We couldn’t auto-detect a landowner board in your workspace. Use{" "}
                  <strong>Import your owners</strong> below to create one from a CSV, or pick a board here.
                </p>
              )}
              <label>
                Owner source
                <select
                  aria-label="Owner source board"
                  value={sourceBoard?.id ?? ""}
                  onChange={(event) => handleSourceBoardSelect(event.target.value)}
                >
                  <option value="">{sourceBoard ? "Keep current" : "Select a board"}</option>
                  {boards.map((board) => (
                    <option key={board.id} value={board.id}>
                      {board.name}
                    </option>
                  ))}
                </select>
              </label>
            </section>
          ) : null}

          <section className="setup-item">
            <h3>Import your owners</h3>
            <p className="subtle">
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

          <section className="setup-item">
            <h3>Where leads go</h3>
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
          </section>

          <article className="setup-item mapping-editor-card">
            <div className="section-heading">
              <div>
                <h3>Field mapping</h3>
                <p className="subtle mapping-editor-subtitle">
                  Match your Monday board columns to the lead fields we deliver. Auto-mapped for you on
                  setup — adjust only if a field landed in the wrong column.
                </p>
                {mapping ? (
                  <p className="subtle mapping-summary-line">{formatColumnSummary(mapping.mapping, lliFields)}</p>
                ) : null}
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
        </div>
      </details>

      {/* ---- ACTIVITY & PIPELINE (read-only history) ---- */}
      <details className="panel disclosure">
        <summary className="disclosure-summary">
          <span className="disclosure-title">Activity &amp; pipeline</span>
          <span className="disclosure-hint">Scan history, deliveries, and obituary volume</span>
        </summary>
        <div className="disclosure-body">
          {pipelineMetrics?.daily?.length ? (
            <section className="setup-item">
              <h3>Pipeline metrics</h3>
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

          <section className="setup-item">
            <h3>Delivery history</h3>
            <ul className="activity-list">
              {(status?.deliveries ?? []).slice(0, 4).map((delivery) => (
                <li key={delivery.id}>
                  <strong>{delivery.item_name}</strong>
                  <span>{humanizeDeliveryStatus(delivery.status)}</span>
                  <span>{humanizeTier(delivery.summary?.tier)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="setup-item">
            <h3>Scan runs</h3>
            <ul className="activity-list">
              {(status?.scan_runs ?? []).slice(0, 4).map((scanRun) => (
                <li key={scanRun.scan_id}>
                  <strong>{scanRun.scan_id}</strong>
                  <span>{humanizeDeliveryStatus(scanRun.last_delivery_status)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </details>
    </main>
  );
}
