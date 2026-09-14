"use client";

import React from "react";
import { usePathname } from "next/navigation";
import Sidebar, { useStageSnapshot } from "@/components/Sidebar";
import OperatorGate from "@/components/OperatorGate";
import { useWorkflowSession } from "@/components/WorkflowSessionContext";
import { TestingWorkflowProvider } from "@/components/TestingWorkflowContext";
import { LockedStage, Icon } from "@/components/StatusPanels";
import { evaluateStage, stageForPath, MODES, TOOL_ROUTES, UNAVAILABLE_ROUTES } from "@/lib/workflowStages";

/**
 * Route guard for every dashboard page. It runs on direct URL entry, browser
 * back/forward and reload, because it re-evaluates prerequisites from the
 * current server artefacts on every render. A locked stage renders an
 * explanation instead of the page (no redirect loop). The backend enforces
 * the same gates independently.
 */
function DashboardContent({ children }) {
  const pathname = usePathname();
  const s = useWorkflowSession();
  const snap = useStageSnapshot();

  if (!s.hydrated) return <LockedStage pending reason="Loading the local session…" />;
  if (!s.operator) return <OperatorGate />;

  let content = children;
  const alwaysOpen = pathname === "/projects" || TOOL_ROUTES.some((t) => t.path === pathname) || UNAVAILABLE_ROUTES.includes(pathname);
  if (!alwaysOpen) {
    const stage = stageForPath(s.mode, pathname);
    if (!stage) {
      const other = s.mode === "tcp" ? "testing" : "tcp";
      content = (
        <LockedStage
          reason={stageForPath(other, pathname) ? `This page belongs to ${MODES[other].label} mode. Switch mode in the top bar to use it.` : "This page is not part of the current workflow."}
          fixPath="/projects"
        />
      );
    } else {
      const access = evaluateStage(s.mode, stage.id, snap);
      if (!access.allowed) content = <LockedStage reason={access.reason} fixPath={access.fixPath} pending={access.pending} />;
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden w-full h-full relative">
      <Sidebar />
      <main id="main" className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden bg-background">
        {s.notice && (
          <div role="status" className="flex items-center justify-between gap-3 bg-amber-50 border-b border-amber-300 text-amber-900 px-4 py-2 text-xs">
            <span className="flex items-center gap-2"><Icon name="info" className="text-[16px]" />{s.notice}</span>
            <button type="button" onClick={s.dismissNotice} className="font-bold underline">Dismiss</button>
          </div>
        )}
        {s.jobError && s.jobError.network && (
          <div role="alert" className="flex items-center justify-between gap-3 bg-red-50 border-b border-red-300 text-red-900 px-4 py-2 text-xs">
            <span className="flex items-center gap-2"><Icon name="cloud_off" className="text-[16px]" />Backend disconnected: the current job revision could not be loaded. Nothing is shown in its place.</span>
            <button type="button" onClick={s.reloadJob} className="font-bold underline">Retry</button>
          </div>
        )}
        {!s.persistent && (
          <div role="status" className="bg-slate-100 border-b border-slate-300 text-slate-700 px-4 py-1 text-[11px]">Browser storage is unavailable: your selection will not survive a reload (stored jobs are unaffected).</div>
        )}
        <div className="flex-1 flex min-h-0 overflow-hidden">{content}</div>
      </main>
    </div>
  );
}

export default function DashboardLayout({ children }) {
  return (
    <TestingWorkflowProvider>
      <DashboardContent>{children}</DashboardContent>
    </TestingWorkflowProvider>
  );
}
