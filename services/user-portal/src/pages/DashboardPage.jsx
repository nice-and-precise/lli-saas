export default function DashboardPage() {
  return (
    <main className="page dashboard-page">
      <section className="panel hero">
        <p className="eyebrow">David Whitaker pilot</p>
        <h1>Scan, connect, verify.</h1>
        <p className="lede">
          Monday connection, first scan launch, and recent lead visibility are laid out
          here as the Phase 1 operating shell.
        </p>
      </section>

      <section className="grid">
        <article className="panel status-card">
          <h2>Monday connection</h2>
          <p className="status offline">Not connected</p>
          <p>Complete OAuth in the CRM adapter, then return here to verify the board link.</p>
        </article>
        <article className="panel status-card">
          <h2>First scan</h2>
          <p className="status ready">Ready</p>
          <p>Run the initial county scan after Monday is connected to create the first lead.</p>
        </article>
        <article className="panel lead-card">
          <h2>Recent lead preview</h2>
          <p className="lead-title">No leads delivered yet</p>
          <p>After the first scan, the latest board item summary will appear here.</p>
        </article>
      </section>
    </main>
  );
}

