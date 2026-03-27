import { startTransition, useEffect, useState } from "react";

import { getRequiredServiceBaseUrl } from "../runtimeConfig";

const INITIAL_FORM = {
  owner_limit: 1000,
  lookback_days: 7,
  reference_date: "",
  source_ids: "",
};

const MAPPING_FIELDS = [
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
];

class HttpJsonError extends Error {
  constructor(message, { status, payload }) {
    super(message);
    this.name = "HttpJsonError";
    this.status = status;
    this.payload = payload;
  }
}

async function fetchJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new HttpJsonError(
      payload?.error ?? payload?.errors?.[0]?.message ?? payload?.issues?.[0]?.message ?? `Request failed for ${path}`,
      {
        status: response.status,
        payload,
      },
    );
  }

  return payload;
}

async function fetchJsonPreservingPayload(baseUrl, path, options = {}, shouldPreserve = () => false) {
  try {
    return await fetchJson(baseUrl, path, options);
  } catch (error) {
    if (error instanceof HttpJsonError && shouldPreserve(error.payload, error.status)) {
      return error.payload;
    }

    throw error;
  }
}

function formatColumnSummary(mapping) {
  return Object.entries(mapping?.columns ?? {})
    .map(([field, columnId]) => `${field} -> ${columnId}`)
    .join(", ");
}

function parseSourceIds(rawValue) {
  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildInitialMappingDraft(mapping) {
  const columns = {};
  for (const field of MAPPING_FIELDS) {
    columns[field] = mapping?.columns?.[field] ?? "";
  }
  return {
    item_name_strategy: mapping?.item_name_strategy ?? "deceased_name_county",
    columns,
  };
}

export default function DashboardPage() {
  const [status, setStatus] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [mappingDraft, setMappingDraft] = useState(buildInitialMappingDraft(null));
  const [boards, setBoards] = useState([]);
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [form, setForm] = useState(INITIAL_FORM);
  const [validation, setValidation] = useState(null);
  const [validatingScan, setValidatingScan] = useState(false);
  const [loading, setLoading] = useState(true);
  const [runningScan, setRunningScan] = useState(false);
  const [savingBoard, setSavingBoard] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
  const [error, setError] = useState("");
  const [validationError, setValidationError] = useState(null);
  const [lastRunSummary, setLastRunSummary] = useState(null);

  async function refreshDashboard() {
    setLoading(true);
    setError("");

    try {
      const crmAdapterBaseUrl = getRequiredServiceBaseUrl("crmAdapterBaseUrl");
      const [statusPayload, mappingResult, boardsResult, validationResult] = await Promise.allSettled([
        fetchJson(crmAdapterBaseUrl, "/status"),
        fetchJson(crmAdapterBaseUrl, "/mapping"),
        fetchJson(crmAdapterBaseUrl, "/boards"),
        fetchJsonPreservingPayload(
          crmAdapterBaseUrl,
          "/validation/pre-scan",
          {},
          (payload) => typeof payload?.ready === "boolean",
        ),
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
          setMappingDraft(buildInitialMappingDraft(mappingResult.value.mapping));
        });
      } else {
        startTransition(() => {
          setMapping(null);
          setMappingDraft(buildInitialMappingDraft(null));
        });
      }

      const validationPayload = validationResult.status === "fulfilled"
        ? validationResult.value
        : validationResult.reason?.message
          ? {
              ready: false,
              status: "action_required",
              issues: [{
                code: "validation_request_failed",
                severity: "error",
                message: validationResult.reason.message,
                guidance: "Resolve the validation issue before starting a scan.",
              }],
            }
          : null;

      startTransition(() => {
        setValidation(validationPayload);
      });

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
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshDashboard();
  }, []);

  async function handleRunScan(event) {
    event.preventDefault();
    setValidatingScan(true);
    setRunningScan(false);
    setError("");

    try {
      const crmAdapterBaseUrl = getRequiredServiceBaseUrl("crmAdapterBaseUrl");
      const validationResult = await fetchJsonPreservingPayload(
        crmAdapterBaseUrl,
        "/validation/pre-scan",
        {},
        (payload) => typeof payload?.ready === "boolean",
      );
      startTransition(() => {
        setValidation(validationResult);
      });

      if (!validationResult.ready) {
        throw new Error("Resolve the Monday validation issues before starting a scan.");
      }

      setRunningScan(true);
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
      setValidatingScan(false);
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
    setValidationError(null);

    try {
      const crmAdapterBaseUrl = getRequiredServiceBaseUrl("crmAdapterBaseUrl");
      await fetchJson(crmAdapterBaseUrl, "/boards/select", {
        method: "POST",
        body: JSON.stringify({ board_id: selectedBoardId }),
      });

      try {
        const validation = await fetchJson(crmAdapterBaseUrl, "/boards/validate");
        startTransition(() => {
          setValidation(validation);
        });
        await refreshDashboard();
      } catch (validationRequestError) {
        if (validationRequestError.message) {
          setValidationError(validationRequestError.message);
        }
        await refreshDashboard();
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingBoard(false);
    }
  }

  async function handleMappingSave(event) {
    event.preventDefault();
    setSavingMapping(true);
    setError("");

    try {
      const crmAdapterBaseUrl = getRequiredServiceBaseUrl("crmAdapterBaseUrl");
      const payload = {
        item_name_strategy: mappingDraft.item_name_strategy,
        columns: Object.fromEntries(
          Object.entries(mappingDraft.columns).filter(([, value]) => value.trim() !== ""),
        ),
      };
      const result = await fetchJson(crmAdapterBaseUrl, "/mapping", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      const refreshedValidation = await fetchJsonPreservingPayload(
        crmAdapterBaseUrl,
        "/validation/pre-scan",
        {},
        (validationPayload) => typeof validationPayload?.ready === "boolean",
      );
      startTransition(() => {
        setMapping(result);
        setMappingDraft(buildInitialMappingDraft(result.mapping));
        setValidation(refreshedValidation);
        setValidationError(null);
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingMapping(false);
    }
  }

  const validationIssues = validation?.issues ?? [];
  const tokenValidation = validation?.token_validation;
  const boardValidation = validation?.board_validation;
  const canRunScan = validation?.ready === true && !loading;
  const validationHeadline = validation?.ready
    ? "Monday setup is ready for a scan."
    : "Fix Monday setup issues before starting a scan.";

  const selectedBoard = status?.board?.name ?? "No destination board selected";
  const deliveryCount = status?.deliveries?.length ?? 0;
  const latestDelivery = status?.latest_delivery;
  const latestLeadSummary = latestDelivery?.summary ?? null;

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

      <section className={`panel validation-panel ${validation?.ready ? "validation-ready" : "validation-blocked"}`}>
        <div className="validation-header">
          <div>
            <p className="eyebrow">Pre-scan validator</p>
            <h2>{validationHeadline}</h2>
            <p className="subtle">
              Checks the selected Monday board, required field mappings, and OAuth readiness before scan submission.
            </p>
          </div>
          <div className={`status ${validation?.ready ? "ready" : "offline"}`}>
            {validation?.ready ? "Ready" : "Action required"}
          </div>
        </div>

        <div className="grid validation-grid">
          <div className="validation-card">
            <h3>OAuth token</h3>
            <p><strong>Status:</strong> {tokenValidation?.status ?? "unknown"}</p>
            <p>{tokenValidation?.message ?? "No validation result yet."}</p>
            {tokenValidation?.guidance ? <p className="subtle">{tokenValidation.guidance}</p> : null}
            <p><strong>Refresh readiness:</strong> {tokenValidation?.refresh?.status ?? "unknown"}</p>
            <p>{tokenValidation?.refresh?.message ?? "No refresh validation result yet."}</p>
            {tokenValidation?.refresh?.guidance ? <p className="subtle">{tokenValidation.refresh.guidance}</p> : null}
          </div>
          <div className="validation-card">
            <h3>Board requirements</h3>
            <p><strong>Board:</strong> {validation?.selected_board?.name ?? "No board selected"}</p>
            <p>Required fields: Owner Name, Obituary URL, Tier</p>
            <ul className="validation-field-list">
              {(boardValidation?.field_results ?? []).map((result) => (
                <li key={result.field}>
                  <strong>{result.label}</strong>: {result.message}
                  {result.guidance ? <span> {result.guidance}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {validationIssues.length > 0 ? (
          <div>
            <h3>What needs attention</h3>
            <ul className="activity-list">
              {validationIssues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>
                  <strong>{issue.message}</strong>
                  <span>{issue.guidance}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {error ? (
        <section className="panel alert-panel">
          <h2>Action needed</h2>
          <p>{error}</p>
        </section>
      ) : null}

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
          <p>{mapping ? formatColumnSummary(mapping.mapping) : "Select a destination board to persist mapping."}</p>
        </article>

        <article className="panel scan-card">
          <h2>Run scan</h2>
          <form className="auth-form scan-form" onSubmit={handleRunScan}>
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
                placeholder="kwbg_boone, the_gazette"
                value={form.source_ids}
                onChange={(event) => setForm((current) => ({ ...current, source_ids: event.target.value }))}
              />
            </label>
            <button type="submit" disabled={runningScan || validatingScan || !canRunScan}>
              {runningScan ? "Running scan..." : "Run obituary scan"}
            </button>
          </form>
          <p className="subtle">
            Each run pulls fresh owner data from Monday instead of scanning a persisted owner corpus.
          </p>
          {!canRunScan ? (
            <p className="subtle">Scan submission is blocked until the pre-scan validator passes.</p>
          ) : null}
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
              <select
                value={selectedBoardId}
                onChange={(event) => setSelectedBoardId(event.target.value)}
              >
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
          {validationError && (
            <div className="alert-panel">
              <h3>Board validation needs attention</h3>
              <p>{validationError}</p>
            </div>
          )}
        </article>

        <article className="panel mapping-editor-card">
          <h2>Mapping editor</h2>
          <form className="auth-form mapping-form" onSubmit={handleMappingSave}>
            <label>
              Item name strategy
              <select
                value={mappingDraft.item_name_strategy}
                onChange={(event) =>
                  setMappingDraft((current) => ({ ...current, item_name_strategy: event.target.value }))
                }
              >
                <option value="deceased_name_county">deceased_name_county</option>
                <option value="deceased_name_only">deceased_name_only</option>
                <option value="deceased_name_address">deceased_name_address</option>
              </select>
            </label>
            <div className="mapping-grid">
              {MAPPING_FIELDS.map((field) => (
                <label key={field}>
                  {field}
                  <input
                    type="text"
                    placeholder="column_id"
                    value={mappingDraft.columns[field] ?? ""}
                    onChange={(event) =>
                      setMappingDraft((current) => ({
                        ...current,
                        columns: {
                          ...current.columns,
                          [field]: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
              ))}
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
    </main>
  );
}
