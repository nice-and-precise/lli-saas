import { startTransition, useEffect, useState } from "react";

const CRM_ADAPTER_BASE_URL = import.meta.env.VITE_CRM_ADAPTER_BASE_URL ?? "http://localhost:3000";

const INITIAL_FORM = {
  county: "Travis",
  state: "TX",
  limit: 5,
};

async function fetchJson(path, options = {}) {
  const response = await fetch(`${CRM_ADAPTER_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed for ${path}`);
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
        fetchJson("/status"),
        fetchJson("/mapping"),
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

  async function handleFirstScan(event) {
    event.preventDefault();
    setRunningScan(true);
    setError("");

    try {
      const result = await fetchJson("/first-scan", {
        method: "POST",
        body: JSON.stringify({
          county: form.county,
          state: form.state,
          limit: Number(form.limit),
          include_contacts: true,
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

  const selectedBoard = status?.board?.name ?? "No board selected";
  const deliveryCount = status?.deliveries?.length ?? 0;
  const latestDelivery = status?.latest_delivery;

  return (
    <main className="page dashboard-page">
      <section className="panel hero hero-grid">
        <div>
          <p className="eyebrow">lli-saas operator flow</p>
          <h1>Monday delivery cockpit.</h1>
          <p className="lede">
            Configure the board, run the first scan, and inspect delivery outcomes from
            the persisted adapter state instead of the Phase 1 placeholder shell.
          </p>
        </div>
        <div className="hero-metrics">
          <div className="metric-chip">
            <span>Board</span>
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
            {loading ? "Loading" : status?.board ? "Board connected" : "Board not selected"}
          </p>
          <p>Tenant: {status?.tenant_id ?? "pilot"}</p>
          <p>Selected board: {selectedBoard}</p>
          <p>Scan runs tracked: {status?.scan_runs?.length ?? 0}</p>
        </article>

        <article className="panel mapping-card">
          <h2>Board mapping</h2>
          <p className="status ready">{mapping?.mapping?.item_name_strategy ?? "Not configured"}</p>
          <p>{mapping ? formatColumnSummary(mapping.mapping) : "Select a board to persist mapping."}</p>
        </article>

        <article className="panel scan-card">
          <h2>First scan launcher</h2>
          <form className="auth-form scan-form" onSubmit={handleFirstScan}>
            <label>
              County
              <input
                type="text"
                value={form.county}
                onChange={(event) => setForm((current) => ({ ...current, county: event.target.value }))}
              />
            </label>
            <label>
              State
              <input
                type="text"
                value={form.state}
                onChange={(event) => setForm((current) => ({ ...current, state: event.target.value.toUpperCase() }))}
              />
            </label>
            <label>
              Lead limit
              <input
                type="number"
                min="1"
                max="25"
                value={form.limit}
                onChange={(event) => setForm((current) => ({ ...current, limit: event.target.value }))}
              />
            </label>
            <button type="submit" disabled={runningScan}>
              {runningScan ? "Running scan..." : "Run first scan"}
            </button>
          </form>
          {lastRunSummary ? (
            <div className="result-strip">
              <strong>{lastRunSummary.scan_id}</strong>
              <span>{lastRunSummary.totals.created} created</span>
              <span>{lastRunSummary.totals.skipped_duplicate} skipped</span>
              <span>{lastRunSummary.totals.failed} failed</span>
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
