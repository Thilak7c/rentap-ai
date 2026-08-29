// frontend/components/UploadZone.js
"use client";

import { useState, useRef, useCallback } from "react";

const ACCEPTED_TYPES = ".pdf,.csv,.xlsx";
const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10; // must match backend MAX_FILES in server.js

export default function UploadZone({ onFilesSelected, status }) {
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState(null);
  const inputRef = useRef(null);

  const validateAndSubmit = useCallback(
    (fileList) => {
      setValidationError(null);
      const files = Array.from(fileList || []);
      if (files.length === 0) return;

      if (files.length > MAX_FILES) {
        setValidationError(`Please select ${MAX_FILES} files or fewer at a time.`);
        return;
      }

      const validFiles = [];
      for (const file of files) {
        const ext = file.name.split(".").pop().toLowerCase();
        if (!["pdf", "csv", "xlsx"].includes(ext)) {
          setValidationError(`"${file.name}" is not a supported type. Only PDF, CSV, and XLSX are supported.`);
          return;
        }
        if (file.size === 0) {
          setValidationError(`"${file.name}" appears to be empty.`);
          return;
        }
        if (file.size > MAX_SIZE_BYTES) {
          setValidationError(`"${file.name}" is too large. Please use files under 10MB.`);
          return;
        }
        validFiles.push(file);
      }

      onFilesSelected(validFiles);
    },
    [onFilesSelected]
  );

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setIsDragging(false);
      validateAndSubmit(e.dataTransfer.files);
    },
    [validateAndSubmit]
  );

  const handleInputChange = useCallback(
    (e) => {
      validateAndSubmit(e.target.files);
      e.target.value = "";
    },
    [validateAndSubmit]
  );

  const isBusy = status === "uploading";

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => !isBusy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !isBusy) inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!isBusy) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={!isBusy ? handleDrop : undefined}
        className={isDragging ? "card-elevated" : "card"}
        style={{
          borderStyle: "dashed",
          borderWidth: 2,
          borderColor: isDragging ? "var(--color-accent)" : "var(--color-border)",
          background: isDragging ? "var(--color-accent-soft)" : "var(--color-surface)",
          padding: "64px 32px",
          textAlign: "center",
          cursor: isBusy ? "default" : "pointer",
          transition: "border-color 160ms var(--ease), background 160ms var(--ease), box-shadow 160ms var(--ease)",
          opacity: isBusy ? 0.6 : 1,
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES}
          onChange={handleInputChange}
          style={{ display: "none" }}
          disabled={isBusy}
        />

        <div
          aria-hidden="true"
          style={{
            width: 52,
            height: 52,
            margin: "0 auto 18px",
            borderRadius: "var(--radius-lg)",
            background: "var(--color-accent-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
          }}
        >
          📄
        </div>
        <p className="text-heading" style={{ margin: "0 0 6px" }}>
          {isBusy ? "Uploading…" : "Drop financial reports here"}
        </p>
        <p className="text-small" style={{ margin: 0 }}>
          {isBusy ? "Please wait" : `or click to browse — PDF, CSV, or XLSX, up to 10MB each, up to ${MAX_FILES} files`}
        </p>
      </div>

      {validationError && (
        <p
          role="alert"
          className="text-small"
          style={{
            marginTop: 12,
            padding: "10px 14px",
            background: "var(--color-high-soft)",
            color: "var(--color-high)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {validationError}
        </p>
      )}
    </div>
  );
}