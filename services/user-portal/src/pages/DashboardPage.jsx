import { startTransition, useEffect, useState } from "react";

const CRM_ADAPTER_BASE_URL = import.meta.env.VITE_CRM_ADAPTER_BASE_URL ?? "http://localhost:3000";
const LEAD_ENGINE_BASE_URL = import.meta.env.VITE_LEAD_ENGINE_BASE_URL ?? "http://localhost:8000";

const INITIAL_FORM = {
  owner_limit: 1000,
};

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

function formatColumnSummary(mapping) {
  return Object.entries(mapping?.columns ?? {})
    .map(([field, columnId]) => `${field} -> ${columnId}`)
    .join(", ");
}

export default function DashboardPage() {
  const [status, setStatus] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [loading, setLoading] = useState(true);
  const [runningScan, setRunningScan] = useState(false);
  const [error, setError] = useState("");
  const [lastRunSummary, setLastRunSummary] = useState(null);

  async function refreshDashboard() {
    setLoading(true);
    setError("");

    try {
      const [statusPayload, mappingResult] = await Promise.allSettled([
        fetchJson(CRM_ADAPTER_BASE_URL, "/status"),
        fetchJson(CRM_ADAPTER_BASE_URL, "/mapping"),
      ]);

      if (statusPayload.status === "fulfilled") {
        startTransition(() => {
          setStatus(statusPayload.value);
        });
      } else {
        throw statusPayload.reason;
      }

      if (mappingResult.status === "fulfilled") {
        startTransition(() => {
          setMapping(mappingResult.value);
        });
      } else {
        startTransition(() => {
          setMapping(null);
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
    setRunningScan(true);
    setError("");

    try {
      const result = await fetchJson(LEAD_ENGINE_BASE_URL, "/run-scan", {
        method: "POST",
        body: JSON.stringify({
          owner_limit: Number(form.owner_limit),
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

  const selectedBoard = status?.board?.name ?? "No destination board selected";
  const deliveryCount = status?.deliveries?.length ?? 0;
  const latestDelivery = status?.latest_delivery;

  return (
    <main className="page dashboard-page">
      <section className="panel hero hero-grid">
        <div>
          <p className="eyebrow">lli-saas orchestration flow</p>
          <h1>Obituary intelligence cockpit.</h1>
          <p className="lede">
            Pull owner records from the Monday <strong>Clients</strong> board, run the
            obituary intelligence scan through <code>lead-engine</code>, and inspect
            destination-board delivery outcomes from the persisted CRM adapter state.
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
            <button type="submit" disabled={runningScan}>
              {runningScan ? "Running scan..." : "Run obituary scan"}
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
        <article className="panel lead-card">
          <h2>Recent delivery</h2>
          {latestDelivery ? (
            <>
              <p className="lead-title">{latestDelivery.item_name}</p>
              <p>Status: {latestDelivery.status}</p>
              <p>Scan: {latestDelivery.scan_id}</p>
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
