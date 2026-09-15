"use client";

import React from "react";
import { useRouter, usePathname } from "next/navigation";
import { useWorkflowSession } from "./WorkflowSessionContext";
import { evaluateStage, stagesFor } from "@/lib/workflowStages";
import { useStageSnapshot } from "./Sidebar";
import { Icon } from "./StatusPanels";

export default function StepperProgress() {
  const router = useRouter();
  const pathname = usePathname();
  const { mode } = useWorkflowSession();
  const snap = useStageSnapshot();
  const stages = stagesFor(mode);
  const activeIndex = stages.findIndex((s) => s.path === pathname);

  return (
    <ol className="w-full py-2 flex items-start justify-between gap-1 select-none" aria-label="Progress">
      {stages.map((step, idx) => {
        const access = evaluateStage(mode, step.id, snap);
        const isActive = idx === activeIndex;
        const isBefore = idx < activeIndex;
        return (
          <li key={step.id} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => access.allowed && router.push(step.path)}
              disabled={!access.allowed}
              title={access.allowed ? `Go to ${step.label}` : access.reason}
              aria-current={isActive ? "step" : undefined}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${isActive ? "bg-blue-600 text-white border-white ring-2 ring-blue-300" : access.allowed ? (isBefore ? "bg-blue-100 text-blue-800 border-blue-300" : "bg-slate-100 text-slate-700 border-slate-300 hover:bg-blue-500 hover:text-white") : "bg-slate-200/60 text-slate-400 border-slate-300/50 cursor-not-allowed"}`}
            >
              {access.allowed ? idx + 1 : <Icon name="lock" className="text-[14px]" />}
              <span className="sr-only">{access.allowed ? "" : `Locked: ${access.reason}`}</span>
            </button>
            <span className={`text-[10px] text-center leading-tight truncate w-full ${isActive ? "font-bold text-blue-700" : access.allowed ? "text-slate-600 font-semibold" : "text-slate-400"}`}>
              {step.shortLabel || step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
