import { useState } from "react";

/* ------------------------------------------------------------------ */
/*  MatchExplainabilityCard                                            */
/*  Displays detailed match metadata for a generated lead:             */
/*    - Confidence band badge & overall score bar                      */
/*    - Per-component score breakdown (expandable)                     */
/*    - Nickname-match indicator                                       */
/*    - Geographic proximity panel                                     */
/*    - Data discrepancies                                             */
/* ------------------------------------------------------------------ */

function ConfidenceBadge({ band }) {
  if (!band) return null;
  const className = `confidence-badge confidence-${band}`;
  const label = band.charAt(0).toUpperCase() + band.slice(1);
  return <span className={className}>{label}</span>;
}

function ScoreBar({ value, max = 100 }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const tone = pct >= 94 ? "high" : pct >= 86 ? "medium" : "low";
  return (
    <div className="score-bar-track">
      <div className={`score-bar-fill score-bar-${tone}`} style={{ width: `${pct}%` }} />
      <span className="score-bar-label">{value.toFixed(1)}</span>
    </div>
  );
}

function ExpandableSection({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="explain-section" open={defaultOpen}>
      <summary onClick={(e) => { e.preventDefault(); setOpen(!open); }}>
        <span className="chevron">{open ? "▾" : "▸"}</span>
        {title}
      </summary>
      {open && <div className="explain-section-body">{children}</div>}
    </details>
  );
}

function NicknameIndicator({ nicknameMatch }) {
  if (!nicknameMatch) return null;
  return (
    <div className="nickname-indicator">
      <span className="nickname-label">Nickname match detected</span>
      <span className="nickname-pair">
        {nicknameMatch.owner_name_used} ↔ {nicknameMatch.obituary_name_used}
      </span>
      <span className="nickname-set">
        Known aliases: {nicknameMatch.nickname_set.join(", ")}
      </span>
    </div>
  );
}

function GeographicProximityPanel({ geo }) {
  if (!geo) return null;
  return (
    <div className="geo-panel">
      <div className="geo-row">
        <span className="geo-label">Owner</span>
        <span className="geo-value">
          {geo.owner_city ?? "—"}{geo.owner_city && geo.owner_state ? ", " : ""}{geo.owner_state ?? "—"}
        </span>
      </div>
      <div className="geo-row">
        <span className="geo-label">Obituary</span>
        <span className="geo-value">
          {geo.obituary_city ?? "—"}{geo.obituary_city && geo.obituary_state ? ", " : ""}{geo.obituary_state ?? "—"}
        </span>
      </div>
      <div className="geo-row">
        <span className="geo-label">Same state</span>
        <span className={`geo-status ${geo.same_state ? "good" : "warn"}`}>
          {geo.same_state ? "Yes" : "No"}
        </span>
      </div>
      {geo.city_match_score != null && (
        <div className="geo-row">
          <span className="geo-label">City match</span>
          <ScoreBar value={geo.city_match_score} />
        </div>
      )}
      {geo.bonus_applied && (
        <span className="geo-bonus-badge">Location bonus applied</span>
      )}
    </div>
  );
}

function DiscrepancyList({ discrepancies }) {
  if (!discrepancies || discrepancies.length === 0) {
    return <p className="no-discrepancies">No data discrepancies detected.</p>;
  }
  return (
    <ul className="discrepancy-list">
      {discrepancies.map((d, i) => (
        <li key={i} className={`discrepancy-item discrepancy-${d.severity}`}>
          <div className="discrepancy-header">
            <strong>{d.field}</strong>
            <span className={`discrepancy-severity pill-sev-${d.severity}`}>{d.severity}</span>
          </div>
          <div className="discrepancy-values">
            <span>Owner: {d.owner_value ?? "—"}</span>
            <span>Obituary: {d.obituary_value ?? "—"}</span>
          </div>
          <p className="discrepancy-note">{d.note}</p>
        </li>
      ))}
    </ul>
  );
}

function ComponentScoreRow({ detail }) {
  const tone = detail.matched ? "matched" : "unmatched";
  return (
    <div className={`component-score-row component-${tone}`}>
      <span className="component-name">{detail.component}</span>
      <div className="component-score-bar">
        <ScoreBar value={detail.score} />
      </div>
      <span className="component-weight">w={detail.weight}</span>
      <span className={`component-status ${detail.matched ? "good" : "warn"}`}>
        {detail.matched ? "✓" : "✗"}
      </span>
    </div>
  );
}

export default function MatchExplainabilityCard({ lead }) {
  if (!lead || !lead.match) {
    return <p className="explain-empty">No match data available.</p>;
  }

  const { match } = lead;
  const score = match.score ?? 0;

  return (
    <div className="explainability-card">
      {/* Header: score + band */}
      <div className="explain-header">
        <div className="explain-header-left">
          <h3>Match Explainability</h3>
          <ConfidenceBadge band={match.confidence_band} />
        </div>
        <div className="explain-header-right">
          <span className="explain-overall-score">{score.toFixed(1)}%</span>
          <span className={`explain-status status-${match.status === "auto_confirmed" ? "confirmed" : "pending"}`}>
            {match.status === "auto_confirmed" ? "Auto-confirmed" : "Pending review"}
          </span>
        </div>
      </div>

      {/* Overall score bar */}
      <div className="explain-score-overall">
        <ScoreBar value={score} />
      </div>

      {/* Component scores */}
      {match.explanation_details && match.explanation_details.length > 0 && (
        <ExpandableSection title="Component Scores" defaultOpen={true}>
          <div className="component-scores-list">
            {match.explanation_details.map((detail, i) => (
              <ComponentScoreRow key={`${detail.component}-${i}`} detail={detail} />
            ))}
          </div>
          {match.explanation && match.explanation.length > 0 && (
            <pre className="explain-raw">{match.explanation.join("\n")}</pre>
          )}
        </ExpandableSection>
      )}

      {/* Nickname match */}
      <NicknameIndicator nicknameMatch={match.nickname_match} />

      {/* Geographic proximity */}
      {match.geographic_proximity && (
        <ExpandableSection title="Geographic Proximity" defaultOpen={false}>
          <GeographicProximityPanel geo={match.geographic_proximity} />
        </ExpandableSection>
      )}

      {/* Data discrepancies */}
      <ExpandableSection title="Data Discrepancies" defaultOpen={false}>
        <DiscrepancyList discrepancies={match.discrepancies} />
      </ExpandableSection>
    </div>
  );
}
