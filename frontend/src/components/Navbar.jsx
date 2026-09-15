"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useWorkflowSession } from "./WorkflowSessionContext";
import { useBackendHealth } from "./useBackendHealth";
import { MODES } from "@/lib/workflowStages";
import { Icon } from "./StatusPanels";

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { hydrated, operator, mode, setMode, job, clearOperator } = useWorkflowSession();
  const health = useBackendHealth();

  if (pathname === "/" || pathname === "/login") return null;

  const switchMode = (next) => {
    if (next === mode) return;
    if (job && !window.confirm("Switching mode closes the current job view. Stored jobs are kept and can be reopened from Projects. Continue?")) return;
    setMode(next);
    router.push(next === "testing" ? "/testing-upload" : "/acquire");
  };

  const healthText = health.status === "online" ? "Backend: online" : health.status === "offline" ? "Backend: disconnected" : "Backend: checking…";
  const healthDot = health.status === "online" ? "bg-emerald-500" : health.status === "offline" ? "bg-red-500" : "bg-slate-400";

  return (
    <header className="bg-surface flex flex-wrap justify-between items-center gap-3 w-full px-margin-desktop min-h-16 py-2 border-b border-outline-variant shrink-0 z-50 sticky top-0">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 bg-primary text-on-primary px-3 py-1 rounded">Skip to content</a>
      <Link href="/projects" className="flex items-center gap-2 group select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded">
        <Icon name="precision_manufacturing" className="text-primary text-[28px]" />
        <span className="font-extrabold text-primary tracking-tight text-lg">
          Vertex Dynamics<span className="font-medium text-on-surface-variant/70 text-sm ml-2 hidden sm:inline">Scan-to-Path Hub · local</span>
        </span>
      </Link>

      <div className="flex flex-wrap items-center gap-3 lg:gap-5">
        <div role="group" aria-label="Workflow mode" className="flex rounded-full border border-outline-variant overflow-hidden text-[11px] font-bold">
          {Object.values(MODES).map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={hydrated && mode === m.id}
              onClick={() => switchMode(m.id)}
              title={m.description}
              className={`px-3 py-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${hydrated && mode === m.id ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container"}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-[11px] font-semibold text-on-surface-variant" title={health.message || "Measured by calling GET /api/health. Camera and robot controller are not integrated."}>
          <span className={`w-2 h-2 rounded-full ${healthDot}`} aria-hidden="true"></span>
          <span>{healthText}</span>
          {health.status === "offline" && (
            <button type="button" onClick={health.retry} className="underline text-primary">Retry</button>
          )}
        </div>

        <Link href="/calibrate" className="text-[11px] font-bold text-primary hover:underline flex items-center gap-1">
          <Icon name="tune" className="text-[16px]" />Calibration routine
        </Link>

        {operator && (
          <div className="flex items-center gap-3 pl-4 border-l border-outline-variant/60">
            <div className="flex flex-col text-right">
              <span className="text-[11px] font-bold text-on-surface leading-none">{operator}</span>
              <span className="text-[10px] text-on-surface-variant font-medium mt-0.5">Operator (attribution only)</span>
            </div>
            <button
              type="button"
              onClick={() => { clearOperator(); router.push("/login"); }}
              className="bg-surface-container-high hover:bg-surface-container text-on-surface-variant px-3 py-1.5 rounded-lg text-xs font-bold border border-outline-variant/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              Change operator
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
