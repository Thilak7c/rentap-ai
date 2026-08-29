// frontend/components/ConsolidatedTable.js

"use client";

import { useMemo, useState, Fragment } from "react";

const SEVERITY_STYLES = {
  high: { color: "var(--color-high)", bg: "var(--color-high-soft)", icon: "⛔", label: "High" },
  warning: { color: "var(--color-warning)", bg: "var(--color-warning-soft)", icon: "⚠️", label: "Warning" },
  info: { color: "var(--color-info)", bg: "var(--color-info-soft)", icon: "ℹ️", label: "Info" },
};

const FILTERS = [
  { id: "all", label: "All rows" },
  { id: "high", label: "High" },
  { id: "warning", label: "Warning" },
  { id: "info", label: "Info" },
  { id: "clean", label: "Clean" },
];

const SEVERITY_RANK = { high: 0, warning: 1, info: 2 };

function buildRowInsightMap(insights) {
  const map = {};
  insights.forEach((insight) => {
    (insight.sourceRowIds || []).forEach((rowId) => {
      if (!map[rowId]) map[rowId] = [];
      map[rowId].push(insight);
    });
  });
  Object.keys(map).forEach((rowId) => {
    map[rowId].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3));
  });
  return map;
}

function getColumns(rows) {
  const keys = new Set();
  rows.forEach((row) => {
    Object.keys(row).forEach((k) => {
      if (k !== "id" && k !== "sourceFile") keys.add(k);
    });
  });
  return Array.from(keys);
}

function formatCell(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

export default function ConsolidatedTable({ rows, insights }) {
  const [filter, setFilter] = useState("all");
  const [expandedRowId, setExpandedRowId] = useState(null);
  const [query, setQuery] = useState("");

  const rowInsightMap = useMemo(() => buildRowInsightMap(insights || []), [insights]);
  const columns = useMemo(() => getColumns(rows || []), [rows]);
  const fileCount = useMemo(() => new Set((rows || []).map((r) => r.sourceFile)).size, [rows]);
  const multiFile = fileCount > 1;

  const filteredRows = useMemo(() => {
    return (rows || []).filter((row) => {
      const rowInsights = rowInsightMap[row.id] || [];
      const topSeverity = rowInsights[0]?.severity;

      if (filter === "clean" && rowInsights.length > 0) return false;
      if (["high", "warning", "info"].includes(filter) && topSeverity !== filter) return false;

      if (query.trim()) {
        const haystack = Object.values(row).join(" ").toLowerCase();
        if (!haystack.includes(query.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [rows, rowInsightMap, filter, query]);

  if (!rows || rows.length === 0) return null;

  const colSpan = columns.length + (multiFile ? 3 : 2);

  return (
    <div className="card" style={{ padding: "20px 24px", marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <p className="text-small" style={{ margin: "0 0 4px", color: "var(--color-ink-faint)", textTransform: "uppercase", letterSpacing: 0.4 }}>
            All extracted data
          </p>
          <p className="text-heading" style={{ margin: 0, fontSize: "1.0625rem" }}>
            {rows.length} row{rows.length === 1 ? "" : "s"}
            {multiFile ? ` across ${fileCount} files` : ""}
          </p>
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search rows…"
          style={{
            border: "1px solid var(--color-border, #e5e5ea)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 12px",
            fontSize: 13.5,
            width: 200,
            outline: "none",
            background: "var(--color-surface-subtle, #fafafa)",
            color: "var(--color-ink)",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {FILTERS.map((f) => {
          const isActive = filter === f.id;
          const meta_ = SEVERITY_STYLES[f.id];
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 999, cursor: "pointer",
                fontSize: 13, fontWeight: 600,
                border: isActive ? `1.5px solid ${meta_?.color || "var(--color-accent)"}` : "1px solid var(--color-border, #e5e5ea)",
                background: isActive ? (meta_?.bg || "var(--color-accent-soft)") : "#fff",
                color: isActive ? (meta_?.color || "var(--color-accent-ink)") : "var(--color-ink-muted)",
              }}
            >
              {meta_ && <span aria-hidden="true">{meta_.icon}</span>}
              {f.label}
            </button>
          );
        })}
      </div>

      <div style={{ maxHeight: 480, overflow: "auto", borderRadius: 12, border: "1px solid var(--color-border, #eee)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead>
            <tr style={{ position: "sticky", top: 0, background: "var(--color-surface-subtle, #fafafa)", zIndex: 1 }}>
              <th style={{ ...thStyle, width: 6, padding: 0 }}></th>
              {multiFile && <th style={thStyle}>File</th>}
              {columns.map((col) => (
                <th key={col} style={thStyle}>{col}</th>
              ))}
              <th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, idx) => {
              const rowInsights = rowInsightMap[row.id] || [];
              const topSeverity = rowInsights[0]?.severity;
              const meta_ = topSeverity ? SEVERITY_STYLES[topSeverity] : null;
              const isExpanded = expandedRowId === row.id;
              const isClickable = rowInsights.length > 0;

              return (
                <Fragment key={row.id || idx}>
                  <tr
                    onClick={() => isClickable && setExpandedRowId(isExpanded ? null : row.id)}
                    style={{
                      cursor: isClickable ? "pointer" : "default",
                      background: meta_ ? meta_.bg : idx % 2 === 0 ? "#fff" : "var(--color-surface-subtle, #fafafa)",
                      borderLeft: meta_ ? `3px solid ${meta_.color}` : "3px solid transparent",
                      borderBottom: "1px solid var(--color-border, #eee)",
                    }}
                  >
                    <td style={{ padding: 0 }}></td>
                    {multiFile && (
                      <td style={tdStyle}>
                        <span
                          style={{
                            fontSize: 11.5, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
                            background: "var(--color-accent-soft)", color: "var(--color-accent-ink)",
                          }}
                        >
                          {row.sourceFile || "—"}
                        </span>
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col} style={tdStyle}>{formatCell(row[col])}</td>
                    ))}
                    <td style={tdStyle}>
                      {meta_ ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600, color: meta_.color }}>
                          <span aria-hidden="true">{meta_.icon}</span>
                          {meta_.label}
                          {rowInsights.length > 1 && ` +${rowInsights.length - 1}`}
                        </span>
                      ) : (
                        <span style={{ color: "var(--color-success)" }}>✓ Clean</span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={colSpan} style={{ padding: 0, borderBottom: "1px solid var(--color-border, #eee)" }}>
                        <div style={{ padding: "10px 16px", background: "var(--color-surface-sunken, #f5f5f7)" }}>
                          {rowInsights.map((insight) => {
                            const im = SEVERITY_STYLES[insight.severity] || SEVERITY_STYLES.info;
                            return (
                              <div key={insight.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "4px 0" }}>
                                <span aria-hidden="true" style={{ color: im.color }}>{im.icon}</span>
                                <span className="text-small" style={{ color: "var(--color-ink)" }}>{insight.message}</span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {filteredRows.length === 0 && (
          <p className="text-small" style={{ textAlign: "center", padding: 24, color: "var(--color-ink-muted)" }}>
            No rows match this filter.
          </p>
        )}
      </div>
    </div>
  );
}

const thStyle = {
  textAlign: "left",
  padding: "10px 14px",
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: 0.3,
  textTransform: "uppercase",
  color: "var(--color-ink-faint)",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "10px 14px",
  whiteSpace: "nowrap",
  color: "var(--color-ink)",
};