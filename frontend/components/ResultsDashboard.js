// frontend/components/ResultsDashboard.js

"use client";

import { useState, Fragment } from "react";
import VisionDisclosure from "./VisionDisclosure";
import Modal from "./Modal";
import DownloadReportButton from "./DownloadReportButton";
import AnimatedLineChart from "./AnimatedLineChart";
import ConsolidatedTable from "./ConsolidatedTable";

const SEVERITY_META = {
  high: { label: "High severity", icon: "⛔", bg: "var(--color-high-soft)", color: "var(--color-high)", caption: "needs review first" },
  warning: { label: "Warning", icon: "⚠️", bg: "var(--color-warning-soft)", color: "var(--color-warning)", caption: "worth a second look" },
  info: { label: "Info", icon: "ℹ️", bg: "var(--color-info-soft)", color: "var(--color-info)", caption: "minor, for awareness" },
};

const TYPE_LABELS = {
  variance: "Variance",
  outlier: "Outlier",
  duplicate: "Duplicate",
};

const PII_TYPE_LABELS = {
  IC: "Malaysian IC Number",
  PHONE: "Phone Number",
  EMAIL: "Email Address",
  ACCOUNT: "Bank Account Number",
  NAME: "Labelled Personal Name",
};

function periodSortKey(label) {
  const match = /Q(\d)\s*(\d{4})/.exec(label || "");
  if (match) return parseInt(match[2], 10) * 10 + parseInt(match[1], 10);
  return 0;
}

function buildPeriodTrend(rows) {
  const totals = {};
  rows.forEach((row) => {
    if (!row.period || typeof row.amount !== "number") return;
    totals[row.period] = (totals[row.period] || 0) + row.amount;
  });
  return Object.entries(totals)
    .map(([period, amount]) => ({ label: period, value: amount }))
    .sort((a, b) => periodSortKey(a.label) - periodSortKey(b.label));
}

export default function ResultsDashboard({ result, showDownload }) {
  const { files, extracted, privacy, insights, summary, _isDemoMode } = result;
  const rowsById = Object.fromEntries((extracted.rows || []).map((r) => [r.id, r]));
  const [activeModal, setActiveModal] = useState(null);

  const insightsBySeverity = (sev) => insights.filter((i) => i.severity === sev);
  const trendData = buildPeriodTrend(extracted.rows || []);

  const failedFiles = files.filter((f) => f.error);
  const succeededFiles = files.filter((f) => !f.error);
  const usedVision = succeededFiles.some((f) => f.extractionMethod === "vision");
  const fileLabel =
    succeededFiles.length === 1
      ? succeededFiles[0].filename
      : `${succeededFiles.length} file${succeededFiles.length === 1 ? "" : "s"} analyzed`;

  const rankedInsights = [...insights]
    .sort((a, b) => {
      const order = { high: 0, warning: 1, info: 2 };
      return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
    })
    .slice(0, 6);

  return (
    <div>
      {_isDemoMode && (
        <div className="badge text-small" style={{ background: "var(--color-warning-soft)", color: "var(--color-warning)", marginBottom: 16, display: "flex", width: "fit-content", marginInline: "auto" }}>
          Demo Mode — showing a saved example result
        </div>
      )}

      {failedFiles.length > 0 && (
        <div className="card text-small" style={{ background: "var(--color-high-soft)", color: "var(--color-high)", padding: "10px 14px", marginBottom: 16 }}>
          {failedFiles.length} file{failedFiles.length === 1 ? "" : "s"} couldn't be processed and {failedFiles.length === 1 ? "was" : "were"} skipped: {failedFiles.map((f) => f.filename).join(", ")}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <div>
          <p className="text-micro" style={{ margin: "0 0 6px", letterSpacing: 0.6, textTransform: "uppercase", color: "var(--color-ink-faint)" }}>
            Analysis completed 
          </p>
          <h2 className="text-hero" style={{ margin: 0, color: "var(--color-ink)" }}>
            {summary.totalInsights === 0
              ? "No anomalies detected"
              : "Complete analysis"}
          </h2>
          {/* <p className="text-small" style={{ margin: "6px 0 0" }}>
            {fileLabel}
            {usedVision && " · read via AI-assisted image extraction"}
          </p> */}
        </div>
        {showDownload && (
          <div className="anim-scale-in">
            <DownloadReportButton result={result} />
          </div>
        )}
      </div>


      
      {/* Stat Card */}
      {summary.totalInsights > 0 && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          {Object.entries(SEVERITY_META).map(([sev, meta_]) => (
            <button key={sev} className="stat-card" onClick={() => setActiveModal(sev)}>
              <div className="stat-card-top">
                <span className="stat-icon" style={{ background: meta_.bg, color: meta_.color }} aria-hidden="true">
                  {meta_.icon}
                </span>
                <span className="text-small" style={{ fontWeight: 600 }}>{meta_.label}</span>
              </div>
              <div>
                <p className="text-figure" style={{ margin: 0, fontSize: "1.75rem", fontWeight: 700, lineHeight: 1, color: "var(--color-ink)" }}>
                  {summary.bySeverity[sev] || 0}
                </p>
                <p className="text-small" style={{ margin: "4px 0 0" }}>{meta_.caption}</p>
              </div>
            </button>
          ))}

          <button className="stat-card" onClick={() => setActiveModal("masked")}>
            <div className="stat-card-top">
              <span className="stat-icon" style={{ background: "var(--color-accent-soft)", color: "var(--color-accent-ink)" }} aria-hidden="true">
                🔒
              </span>
              <span className="text-small" style={{ fontWeight: 600 }}>Fields masked</span>
            </div>
            <div>
              <p className="text-figure" style={{ margin: 0, fontSize: "1.75rem", fontWeight: 700, lineHeight: 1, color: "var(--color-ink)" }}>
                {privacy.maskedCount}
              </p>
              <p className="text-small" style={{ margin: "4px 0 0" }}>PII protected</p>
            </div>
          </button>
        </div>
      )}

      <ConsolidatedTable rows={extracted.rows} insights={insights} />


      {/* <div
        style={{
          display: "grid",
          gridTemplateColumns: trendData.length > 1 ? "minmax(0, 2fr) minmax(280px, 1fr)" : "1fr",
          gap: 20,
          marginBottom: 20,
          alignItems: "start",
        }}
      >


        {trendData.length > 1 && (
          <div className="card" style={{ padding: "18px 20px" }}>
            <p
              className="text-small"
              style={{ margin: "0 0 4px", color: "var(--color-ink-faint)", textTransform: "uppercase", letterSpacing: 0.4 }}
            >
              Trend
            </p>
            <p className="text-heading" style={{ margin: "0 0 16px", fontSize: "1.0625rem" }}>
              Total amount by period
            </p>
            <AnimatedLineChart
              data={trendData}
              valueFormatter={(v) => `RM${v.toLocaleString()}`}
              lineColor="var(--color-accent)"
            />
            <p className="text-small" style={{ margin: "16px 0 0", color: "var(--color-ink-muted)" }}>
              Aggregated from all line items across the document.
            </p>
          </div>
        )}

        {summary.totalInsights > 0 && (
          <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <p className="text-heading" style={{ margin: 0, fontSize: "1.0625rem" }}>Top insights</p>
              <button
                className="text-small"
                style={{ background: "none", border: "none", color: "var(--color-accent)", fontWeight: 600, cursor: "pointer", padding: 0 }}
                onClick={() => setActiveModal("high")}
              >
                View all
              </button>
            </div>
            {rankedInsights.map((insight) => {
              const meta_ = SEVERITY_META[insight.severity] || SEVERITY_META.info;
              return (
                <button
                  key={insight.id}
                  onClick={() => setActiveModal(insight.severity)}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    padding: "10px 0", borderTop: "1px solid var(--color-border, #eee)",
                    background: "none", border: "none", borderTopWidth: "1px", width: "100%",
                    textAlign: "left", cursor: "pointer",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                      background: meta_.bg, color: meta_.color,
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
                    }}
                  >
                    {meta_.icon}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="text-small" style={{ display: "block", fontWeight: 600, color: "var(--color-ink)" }}>
                      {TYPE_LABELS[insight.type] || insight.type}
                    </span>
                    <span
                      className="text-small"
                      style={{
                        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                        overflow: "hidden", color: "var(--color-ink-muted)",
                      }}
                    >
                      {insight.message}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div> */}

      <VisionDisclosure extractionMethod={usedVision ? "vision" : "text"} />


      {summary.totalInsights === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "48px 20px" }}>
          <div
            aria-hidden="true"
            style={{
              width: 48, height: 48, margin: "0 auto 14px", borderRadius: "50%",
              background: "var(--color-success-soft)", display: "flex",
              alignItems: "center", justifyContent: "center", fontSize: 22, color: "var(--color-success)",
            }}
          >
            ✓
          </div>
          <p className="text-body" style={{ margin: 0, color: "var(--color-ink-muted)" }}>
            We reviewed {extracted.rowCount} line items and found nothing unusual.
            {privacy.maskedCount === 0 && " No personal information was detected either."}
          </p>
        </div>
      )}

      {["high", "warning", "info"].includes(activeModal) && (
        <Modal
          title={SEVERITY_META[activeModal].label}
          subtitle={`${insightsBySeverity(activeModal).length} insight${insightsBySeverity(activeModal).length === 1 ? "" : "s"}`}
          onClose={() => setActiveModal(null)}
        >
          <InsightTable insights={insightsBySeverity(activeModal)} rowsById={rowsById} emptyLabel={`No ${activeModal} insights.`} />
        </Modal>
      )}

      {activeModal === "masked" && (
        <Modal
          title="Fields masked for privacy"
          subtitle={`${privacy.maskedCount} field${privacy.maskedCount === 1 ? "" : "s"} detected and masked`}
          onClose={() => setActiveModal(null)}
        >
          {privacy.maskedCount === 0 ? (
            <p className="text-body" style={{ color: "var(--color-ink-muted)" }}>No personal information detected in this document.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="text-micro">Field</th>
                  <th className="text-micro">Type</th>
                  <th className="text-micro">Row</th>
                </tr>
              </thead>
              <tbody>
                {privacy.matches.map((m, i) => (
                  <tr key={i}>
                    <td className="text-small">{m.field}</td>
                    <td className="text-small">{PII_TYPE_LABELS[m.type] || m.type}</td>
                    <td className="text-figure" style={{ fontSize: 12.5 }}>{m.rowId || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-small" style={{ marginTop: 14, opacity: 0.75 }}>
            Original values are never stored or displayed — only the type of information found.
          </p>
        </Modal>
      )}
    </div>
  );
}

function InsightTable({ insights, rowsById, emptyLabel }) {
  const [expandedId, setExpandedId] = useState(null);

  if (insights.length === 0) {
    return <p className="text-body" style={{ color: "var(--color-ink-muted)" }}>{emptyLabel}</p>;
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th className="text-micro">Type</th>
          <th className="text-micro">Message</th>
        </tr>
      </thead>
      <tbody>
        {insights.map((insight) => {
          const sourceRows = (insight.sourceRowIds || []).map((id) => rowsById?.[id]).filter(Boolean);
          const isExpanded = expandedId === insight.id;
          return (
            <Fragment key={insight.id}>
              <tr
                className="table-row-clickable"
                onClick={() => setExpandedId(isExpanded ? null : insight.id)}
              >
                <td className="text-small" style={{ whiteSpace: "nowrap", fontWeight: 600 }}>
                  {TYPE_LABELS[insight.type] || insight.type}
                </td>
                <td className="text-small" style={{ color: "var(--color-ink)" }}>
                  {insight.message}
                  {sourceRows.length > 0 && (
                    <span className="text-small" style={{ color: "var(--color-accent)", marginLeft: 8, fontWeight: 600 }}>
                      {isExpanded ? "Hide rows ▲" : "View rows ▼"}
                    </span>
                  )}
                </td>
              </tr>
              {isExpanded && sourceRows.length > 0 && (
                <tr>
                  <td colSpan={2} style={{ padding: 0 }}>
                    <div className="text-figure" style={{ background: "var(--color-surface-sunken)", borderRadius: "var(--radius-sm)", padding: "10px 12px", margin: "0 0 10px", fontSize: 12.5, overflowX: "auto" }}>
                      {sourceRows.map((row) => (
                        <div key={row.id} className="divider-row" style={{ display: "flex", gap: 16, padding: "5px 0" }}>
                          {Object.entries(row).filter(([k]) => k !== "id").map(([k, v]) => (
                            <span key={k}>
                              <span style={{ color: "var(--color-ink-faint)" }}>{k}: </span>
                              {String(v)}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}