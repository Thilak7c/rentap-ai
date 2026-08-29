// frontend/components/StagedFile.js

"use client";

function formatSize(bytes) {
  return bytes > 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function extIcon(name) {
  const ext = name.split(".").pop().toLowerCase();
  if (ext === "pdf") return "📕";
  if (ext === "xlsx" || ext === "xls") return "📗";
  if (ext === "csv") return "📊";
  return "📄";
}

export default function StagedFile({ files, onProceed, onChooseDifferent }) {
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const isSingle = files.length === 1;

  return (
    <div className="card-elevated anim-fade-up" style={{ padding: "32px", textAlign: "center" }}>
      <div className="staged-file-icon" style={{ margin: "0 auto 16px" }} aria-hidden="true">
        {isSingle ? extIcon(files[0].name) : "🗂️"}
      </div>

      {isSingle ? (
        <>
          <p className="text-heading" style={{ margin: "0 0 4px" }}>{files[0].name}</p>
          <p className="text-small" style={{ margin: "0 0 24px" }}>{formatSize(files[0].size)} · ready to analyze</p>
        </>
      ) : (
        <>
          <p className="text-heading" style={{ margin: "0 0 4px" }}>{files.length} files staged</p>
          <p className="text-small" style={{ margin: "0 0 16px" }}>{formatSize(totalSize)} total · ready to analyze</p>

          <div
            style={{
              maxHeight: 220,
              overflowY: "auto",
              margin: "0 0 24px",
              maxWidth: 420,
              marginInline: "auto",
              borderRadius: 12,
              border: "1px solid var(--color-border, #e5e5ea)",
              background: "var(--color-surface-subtle, #fafafa)",
              textAlign: "left",
            }}
          >
            {files.map((f, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  borderBottom: i < files.length - 1 ? "1px solid var(--color-border, #eee)" : "none",
                }}
              >
                <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }} aria-hidden="true">
                  {extIcon(f.name)}
                </span>
                <span
                  className="text-small"
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: "var(--color-ink)",
                  }}
                  title={f.name}
                >
                  {f.name}
                </span>
                <span className="text-small" style={{ color: "var(--color-ink-muted)", flexShrink: 0 }}>
                  {formatSize(f.size)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
        <button className="btn btn-text" onClick={onChooseDifferent}>
          Choose different files
        </button>
        <button
          className="btn btn-primary"
          onClick={onProceed}
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          Proceed to Analyze
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
      </div>
    </div>
  );
}