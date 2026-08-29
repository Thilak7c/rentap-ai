// frontend/app/page.js

"use client";

import Link from "next/link";
import AnimatedLineChart from "../components/AnimatedLineChart";
import RotatingChart from "../components/RotatingChart";

// Decorative sample trend — no real report exists pre-login, so this
// illustrates the kind of output the tool produces rather than real data.
const HERO_TREND_DATA = [
  { label: "Q1 2026", value: 45000 },
  { label: "Q2 2026", value: 198000 },
  { label: "Q3 2026", value: 132000 },
  { label: "Q4 2026", value: 210000 },
];

function BrandMarkIcon({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="rentapGradientLanding" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6B85FF" />
          <stop offset="100%" stopColor="#4F6EF7" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#rentapGradientLanding)" />
      <image href="/logo.svg" x="10" y="10" width="44" height="44" preserveAspectRatio="xMidYMid meet" />
    </svg>
  );
}

// Original line-art illustration — built for Rentap AI, not a reproduction
// of any reference artwork. A figure at a laptop (mini bar-chart on screen)
// with a floating "insight card" showing a trend line and a verified check.
function HeroIllustration() {
  return (
    <svg
      viewBox="0 0 480 380"
      width="100%"
      height="auto"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      {/* desk line */}
      <line x1="30" y1="330" x2="450" y2="330" stroke="var(--color-ink)" strokeWidth="3" strokeLinecap="round" />

      {/* sparkles */}
      <g stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round">
        <path d="M250 70 L250 82 M244 76 L256 76" />
        <path d="M432 96 L432 106 M427 101 L437 101" />
      </g>

      {/* person: hair + head + body */}
      <path
        d="M108 86 C104 60 120 40 150 40 C180 40 196 60 192 86 C196 94 192 108 184 110 C186 90 176 80 150 80 C124 80 114 90 116 110 C108 108 104 94 108 86 Z"
        fill="var(--color-ink)"
      />
      <circle cx="150" cy="102" r="30" fill="#fff" stroke="var(--color-ink)" strokeWidth="2.5" />
      <circle cx="140" cy="103" r="2" fill="var(--color-ink)" />
      <circle cx="160" cy="103" r="2" fill="var(--color-ink)" />
      <path d="M140 114 Q150 120 160 114" stroke="var(--color-ink)" strokeWidth="2.5" fill="none" strokeLinecap="round" />

      <path
        d="M110 330 C108 244 118 196 150 191 C182 196 192 244 190 330 Z"
        fill="#fff"
        stroke="var(--color-ink)"
        strokeWidth="2.5"
      />

      {/* dotted shirt pattern */}
      <g fill="var(--color-accent)">
        <circle cx="130" cy="235" r="3" />
        <circle cx="150" cy="225" r="3" />
        <circle cx="170" cy="235" r="3" />
        <circle cx="120" cy="264" r="3" />
        <circle cx="145" cy="259" r="3" />
        <circle cx="170" cy="266" r="3" />
        <circle cx="135" cy="294" r="3" />
        <circle cx="160" cy="296" r="3" />
      </g>

      {/* arms reaching to laptop */}
      <path d="M118 246 C100 260 95 284 108 304" stroke="var(--color-ink)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M182 246 C200 260 205 284 192 304" stroke="var(--color-ink)" strokeWidth="2.5" fill="none" strokeLinecap="round" />

      {/* laptop */}
      <rect x="95" y="216" width="120" height="86" rx="6" fill="#fff" stroke="var(--color-ink)" strokeWidth="2.5" />
      <path d="M80 302 L230 302 L218 322 L92 322 Z" fill="#fff" stroke="var(--color-ink)" strokeWidth="2.5" strokeLinejoin="round" />

      {/* mini bar chart on laptop screen */}
      <g fill="var(--color-accent)">
        <rect x="115" y="276" width="10" height="18" rx="2" />
        <rect x="132" y="256" width="10" height="38" rx="2" />
        <rect x="149" y="241" width="10" height="53" rx="2" />
        <rect x="166" y="264" width="10" height="30" rx="2" />
        <rect x="183" y="248" width="10" height="46" rx="2" />
      </g>

      {/* floating insight card */}
      <rect x="270" y="120" width="170" height="150" rx="16" fill="#fff" stroke="var(--color-ink)" strokeWidth="2.5" />
      <line x1="292" y1="150" x2="380" y2="150" stroke="var(--color-ink)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="292" y1="168" x2="418" y2="168" stroke="var(--color-border-strong)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="292" y1="184" x2="400" y2="184" stroke="var(--color-border-strong)" strokeWidth="2.5" strokeLinecap="round" />
      <polyline
        points="292,235 320,215 348,228 376,200 404,212"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="410" cy="240" r="18" fill="var(--color-accent)" />
      <path d="M402 240 L408 246 L419 233" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const HOW_IT_WORKS_STEPS = [
  {
    icon: "1",
    title: "Upload your report",
    body: "Drop in a PDF or spreadsheet — no accountant, no setup required.",
  },
  {
    icon: "2",
    title: "We analyse it",
    body: "Rule-based checks flag trends, anomalies, and risks — every finding explainable, not a black box.",
  },
  {
    icon: "3",
    title: "Review & export",
    body: "Drill into any insight down to its source row, then export a clean PDF summary.",
  },
];

export default function LandingPage() {
  return (
    <div className="landing-root">
      <style>{`
        .landing-root {
          min-height: 100vh;
          background: linear-gradient(180deg, var(--color-accent-soft) 0%, var(--color-paper) 460px, var(--color-paper) 100%);
        }

        /* ---- Nav ---- */
        .landing-nav-wrap {
          max-width: 1120px;
          margin: 0 auto;
          padding: 24px 24px 0;
        }
        .landing-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-md);
          padding: 12px 16px 12px 20px;
        }
        .landing-nav-brand {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .landing-nav-links {
          display: flex;
          align-items: center;
          gap: 28px;
        }
        .landing-nav-links a {
          font-size: var(--text-small);
          font-weight: 600;
          color: var(--color-ink-muted);
          text-decoration: none;
        }
        .landing-nav-links a:hover {
          color: var(--color-ink);
        }
        @media (max-width: 760px) {
          .landing-nav-links {
            display: none;
          }
        }

        /* ---- Hero ---- */
        .landing-hero {
          max-width: 1120px;
          margin: 0 auto;
          padding: 56px 32px 40px;
          display: flex;
          align-items: center;
          gap: 56px;
        }
        .landing-hero-text {
          flex: 1;
          min-width: 0;
        }
        .landing-hero-visual {
          flex: 1;
          min-width: 0;
          max-width: 460px;
        }
        .landing-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-pill);
          padding: 6px 14px 6px 10px;
          font-size: var(--text-small);
          font-weight: 600;
          color: var(--color-ink-muted);
          margin-bottom: 22px;
        }
        .landing-badge-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--color-accent);
          flex-shrink: 0;
        }
        .landing-headline {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: clamp(2.4rem, 4.4vw, 3.4rem);
          line-height: 1.12;
          letter-spacing: -0.03em;
          margin: 0 0 22px;
          color: var(--color-ink);
        }
        .landing-highlight {
          background: var(--color-accent-soft);
          border-radius: 8px;
          padding: 0 8px;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
        }
        .landing-subcopy {
          font-size: 1.0625rem;
          line-height: 1.6;
          color: var(--color-ink-muted);
          max-width: 440px;
          margin: 0 0 30px;
        }
        .landing-cta-row {
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
          margin-bottom: 30px;
        }
        .landing-trust-strip {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          font-size: var(--text-small);
          color: var(--color-ink-faint);
        }
        .landing-trust-strip .dot {
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: var(--color-ink-faint);
          flex-shrink: 0;
        }
        .landing-visual-caption {
          text-align: center;
          font-size: var(--text-small);
          color: var(--color-ink-muted);
          max-width: 360px;
          margin: 18px auto 0;
        }
        @media (max-width: 860px) {
          .landing-hero {
            flex-direction: column-reverse;
            padding-top: 32px;
            gap: 36px;
          }
          .landing-hero-visual, .landing-hero-text {
            width: 100%;
            max-width: none;
          }
          .landing-subcopy {
            max-width: none;
          }
        }

        /* ---- How it works ---- */
        .landing-how {
          max-width: 1120px;
          margin: 0 auto;
          padding: 24px 32px 64px;
        }
        .landing-how-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          margin-top: 28px;
        }
        .landing-step-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: 22px 20px;
          box-shadow: var(--shadow-sm);
        }
        .landing-step-num {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          background: var(--color-accent);
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 14px;
        }
        @media (max-width: 760px) {
          .landing-how-grid {
            grid-template-columns: 1fr;
          }
        }

      `}</style>

      <div className="landing-nav-wrap">
        <nav className="landing-nav">
          <div className="landing-nav-brand">
            <BrandMarkIcon size={34} />
            <span className="brand-name" style={{ fontSize: "1rem" }}>Rentap AI</span>
          </div>
          <div className="landing-nav-links">
            <a href="#how-it-works">How it works</a>
            <a href="#preview">Preview</a>
          </div>
          <Link href="/app" className="btn btn-primary">
            Login
          </Link>
        </nav>
      </div>

      <section className="landing-hero">
        <div className="landing-hero-text">
          <span className="landing-badge">
            <span className="landing-badge-dot" />
            Built for DevLeague 2026 · Lab 1
          </span>
          <h1 className="landing-headline">
            Explainable <span className="landing-highlight">financial analysis</span>
            <br />
            for Malaysian SMEs
          </h1>
          <p className="landing-subcopy">
            Upload a PDF or spreadsheet and get trend, anomaly, and risk insights
            explained down to the source row — with personal data masked
            automatically and nothing kept after your session.
          </p>
          <div className="landing-cta-row">
            <Link href="/app" className="btn btn-primary" style={{ padding: "13px 26px", fontSize: "1rem" }}>
              Analyse a report →
            </Link>
            <a href="#how-it-works" className="btn btn-secondary" style={{ padding: "13px 26px", fontSize: "1rem" }}>
              See how it works
            </a>
          </div>
          <div className="landing-trust-strip">
            <span>Rule-based, explainable insights</span>
            <span className="dot" />
            <span>Automatic PII masking</span>
            <span className="dot" />
            <span>No data stored after your session</span>
          </div>
        </div>
        <div className="landing-hero-visual">
          <HeroIllustration />
          <p className="landing-visual-caption">
            Built specifically for Malaysian financial teams — explainable insights, not black-box summaries.
          </p>
        </div>
      </section>

      <section id="how-it-works" className="landing-how">
        <p className="text-micro" style={{ margin: "0 0 6px" }}>How it works</p>
        <h2 className="text-hero" style={{ fontSize: "1.9rem", margin: 0 }}>
          From upload to insight in three steps
        </h2>
        <div className="landing-how-grid">
          {HOW_IT_WORKS_STEPS.map((step) => (
            <div key={step.icon} className="landing-step-card">
              <div className="landing-step-num">{step.icon}</div>
              <p className="text-heading" style={{ margin: "0 0 8px" }}>{step.title}</p>
              <p className="text-small" style={{ margin: 0, color: "var(--color-ink-muted)" }}>{step.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}