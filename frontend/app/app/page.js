// frontend/app/app/page.js

"use client";

import { useState, useCallback } from "react";
import UploadZone from "../../components/UploadZone";
import StagedFile from "../../components/StagedFile";
import StepTracker from "../../components/StepTracker";
import ProcessingState from "../../components/ProcessingState";
import ErrorState from "../../components/ErrorState";
import ResultsDashboard from "../../components/ResultsDashboard";
import PrivacyNotice from "../../components/PrivacyNotice";
import Toast from "../../components/Toast";
import Confetti from "../../components/Confetti";
import { processFiles, ApiError, ErrorCodes } from "../../lib/api";
import { DEMO_MODE_RESPONSE } from "../../lib/demoModeData";

const STATUS = {
  IDLE: "idle",
  STAGED: "staged",
  PROCESSING: "processing",
  RESULTS: "results",
  ERROR: "error",
};

const STEPS = ["Upload document", "Extract & mask", "Review insights"];

const PAGE_TITLES = {
  [STATUS.IDLE]: "Upload a report",
  [STATUS.STAGED]: "Ready to analyze",
  [STATUS.PROCESSING]: "Analyzing…",
  [STATUS.RESULTS]: "Results",
  [STATUS.ERROR]: "Something went wrong",
};

const MIN_PROCESSING_MS = 3200;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function currentStepIndex(status) {
  if (status === STATUS.PROCESSING) return 1;
  if (status === STATUS.RESULTS) return 2;
  if (status === STATUS.ERROR) return 1;
  return 0;
}

function BrandMarkIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="rentapGradient3" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6B85FF" />
          <stop offset="100%" stopColor="#4F6EF7" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#rentapGradient3)" />
      <image href="/logo.svg" x="10" y="10" width="44" height="44" preserveAspectRatio="xMidYMid meet" />
    </svg>
  );
}

export default function HomePage() {
  const [status, setStatus] = useState(STATUS.IDLE);
  const [stagedFiles, setStagedFiles] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [showDownload, setShowDownload] = useState(false);

  const handleFilesValidated = useCallback((files) => {
    setStagedFiles(files);
    setStatus(STATUS.STAGED);
  }, []);

  const handleChooseDifferentFiles = useCallback(() => {
    setStagedFiles([]);
    setStatus(STATUS.IDLE);
  }, []);

  const runAnalysis = useCallback(async (files) => {
    setStatus(STATUS.PROCESSING);
    setError(null);
    setShowDownload(false);

    const minDelay = wait(MIN_PROCESSING_MS);

    try {
      const [data] = await Promise.all([processFiles(files), minDelay]);
      setResult(data);
      setStatus(STATUS.RESULTS);
      setShowConfetti(true);
      setShowToast(true);
      setShowDownload(true);
    } catch (err) {
      await minDelay;
      const code = err instanceof ApiError ? err.code : ErrorCodes.NETWORK_ERROR;
      setError({ code, message: err.message });
      setStatus(STATUS.ERROR);
    }
  }, []);

  const handleProceedToAnalyze = useCallback(() => {
    if (stagedFiles.length > 0) runAnalysis(stagedFiles);
  }, [stagedFiles, runAnalysis]);

  const handleUseDemoMode = useCallback(() => {
    setResult(DEMO_MODE_RESPONSE);
    setStatus(STATUS.RESULTS);
    setShowConfetti(true);
    setShowToast(true);
    setShowDownload(true);
  }, []);

  const handleReset = useCallback(() => {
    setStatus(STATUS.IDLE);
    setStagedFiles([]);
    setResult(null);
    setError(null);
    setShowConfetti(false);
    setShowToast(false);
    setShowDownload(false);
  }, []);

  const activeStep = currentStepIndex(status);

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <button
          onClick={handleReset}
          style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
        >
          <BrandMarkIcon />
          <div>
            <div className="brand-name">Rentap AI</div>
            <div className="text-micro" style={{ marginTop: 2 }}>Lab 1 · DevLeague 2026</div>
          </div>
        </button>

        <nav className="sidebar-section" style={{ marginTop: 8 }}>
          <button
            onClick={handleReset}
            style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%",
              background: "var(--color-accent-soft)", border: "none", borderRadius: "var(--radius-md)",
              padding: "10px 12px", cursor: "pointer", textAlign: "left",
              color: "var(--color-accent-ink)", fontWeight: 600,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 9.5 12 3l9 6.5" />
              <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
            </svg>
            <span className="text-small">Home</span>
          </button>
        </nav>
      </aside>

      <main className="app-main">
        <div className="app-header">
          <h1 className="text-heading" style={{ margin: 0 }}>{PAGE_TITLES[status]}</h1>
          {status === STATUS.RESULTS && result && showDownload && (
            <div className="anim-scale-in">
              <button onClick={handleReset} className="btn btn-secondary">
                Analyze another
              </button>
            </div>
          )}
        </div>

        <div style={{ maxWidth: status === STATUS.RESULTS ? 1100 : 720, margin: "0 auto", padding: "32px 24px 80px", width: "100%" }}>
          <StepTracker steps={STEPS} activeIndex={activeStep} />

          {status === STATUS.IDLE && (
             <>
              <p className="text-body" style={{ margin: "0 0 24px", color: "var(--color-ink-muted)", maxWidth: 480 }}>
                Upload financial reports to get AI-assisted extraction with explainable,
                rule-based insights — every finding traces back to the source data.
              </p>
              <UploadZone onFilesSelected={handleFilesValidated} status={status} />
              <PrivacyNotice />
            </>
          )}

          {status === STATUS.STAGED && stagedFiles.length > 0 && (
            <StagedFile files={stagedFiles} onProceed={handleProceedToAnalyze} onChooseDifferent={handleChooseDifferentFiles} />
          )}

          {status === STATUS.PROCESSING && <ProcessingState />}

          {status === STATUS.ERROR && (
            <ErrorState code={error?.code} message={error?.message} onRetry={handleReset} onUseDemoMode={handleUseDemoMode} />
          )}

          {status === STATUS.RESULTS && result && (
            <ResultsDashboard result={result} showDownload={showDownload} />
          )}
        </div>
      </main>

      {showConfetti && <Confetti onDone={() => setShowConfetti(false)} />}
      {showToast && <Toast message="Analysis complete — insights are ready" onDone={() => setShowToast(false)} />}
    </div>
  );
}