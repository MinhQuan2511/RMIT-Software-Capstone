"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkflowSession } from "./WorkflowSessionContext";
import { useTestingWorkflow } from "./TestingWorkflowContext";
import { evaluateStage, stagesFor, TOOL_ROUTES, MODES } from "@/lib/workflowStages";
import { Icon, SourceKindBadge } from "./StatusPanels";

/** Stage snapshot from server artefacts (job, source) plus the in-memory Testing sheet. */
export function useStageSnapshot() {
  const s = useWorkflowSession();
  const { sheet } = useTestingWorkflow();
  return {
    projectId: s.projectId,
    sourceId: s.sourceId,
    stagedSheet: !!(sheet && sheet.rows && sheet.rows.length),
    job: s.job,
    jobLoading: s.jobLoading,
    jobError: s.jobError ? s.jobError.message : null,
  };
}

export default function Sidebar() {
  const pathname = usePathname();
  const { mode, job, projectId } = useWorkflowSession();
  const snap = useStageSnapshot();

  return (
    <nav aria-label="Workflow steps" className="bg-surface-container-low flex flex-col w-[260px] h-full pt-6 px-4 gap-2 border-r border-outline-variant shadow-sm z-40 shrink-0 overflow-y-auto">
      <div className="mb-4 px-3">
        <h2 className="text-lg font-extrabold text-on-surface leading-tight">{MODES[mode]?.label || "Workflow"}</h2>
        <p className="text-[10px] text-on-surface-variant font-bold uppercase mt-1 tracking-widest">Workflow steps</p>
      </div>

      <ol className="flex flex-col gap-1.5 w-full">
        {stagesFor(mode).map((step, idx) => {
          const isActive = pathname === step.path;
          const access = evaluateStage(mode, step.id, snap);
          return (
            <li key={step.id}>
              {access.allowed ? (
                <Link
                  href={step.path}
                  aria-current={isActive ? "step" : undefined}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${isActive ? "bg-primary-container text-on-primary-container shadow-sm" : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"}`}
                >
                  <span className="text-[10px] font-mono w-4 text-right" aria-hidden="true">{idx + 1}</span>
                  <Icon name={step.icon} className="text-lg" />
                  <span className="text-sm">{step.label}</span>
                </Link>
              ) : (
                <div className="flex flex-col px-3 py-2.5 rounded-xl text-on-surface-variant/60 cursor-not-allowed" aria-disabled="true">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono w-4 text-right" aria-hidden="true">{idx + 1}</span>
                    <Icon name={access.pending ? "hourglass_top" : "lock"} className="text-lg" />
                    <span className="text-sm font-semibold">{step.label}</span>
                  </div>
                  <span className="text-[10px] leading-snug ml-7 mt-0.5">{access.reason}</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-4 px-3">
        <p className="text-[10px] text-on-surface-variant font-bold uppercase tracking-widest mb-1">Tools</p>
        {TOOL_ROUTES.map((t) => (
          <Link key={t.path} href={t.path} aria-current={pathname === t.path ? "page" : undefined} className={`flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${pathname === t.path ? "bg-primary-container text-on-primary-container" : "text-on-surface-variant hover:bg-surface-container-high"}`}>
            <Icon name={t.icon} className="text-lg" />{t.label}
          </Link>
        ))}
      </div>

      <div className="mt-auto mb-4 mx-1 p-3 rounded-lg border border-outline-variant bg-surface text-[10px] leading-relaxed text-on-surface-variant">
        <p className="font-bold uppercase tracking-wider mb-1">Current selection</p>
        <p>Project: <span className="font-mono">{projectId ? `${projectId.slice(0, 12)}…` : "none"}</span></p>
        {job ? (
          <>
            <p className="break-all">Job: <span className="font-mono">{job.record.jobId.slice(0, 12)}…</span> r{job.record.revision}</p>
            <p className="break-all">Source: {job.record.source.displayName}</p>
            <div className="mt-1"><SourceKindBadge kind={job.record.source.kind} /></div>
          </>
        ) : (
          <p>Job: none</p>
        )}
      </div>
    </nav>
  );
}
