"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIntegrationMode } from "./IntegrationModeContext";
import { useTcpWorkflow } from "./TcpWorkflowContext";

export default function Sidebar() {
  const pathname = usePathname();
  const { workflowSteps } = useIntegrationMode();
  const { canNavigateToStep, workflowMode } = useTcpWorkflow();

  return (
    <nav className="bg-surface-container-low flex flex-col w-[280px] h-full pt-6 px-4 gap-2 border-r border-outline-variant shadow-sm z-40 shrink-0 select-none">
      <div className="mb-6 px-3">
        <h2 className="font-headline-md text-xl font-extrabold text-on-surface leading-tight">Control Center</h2>
        <p className="font-label-md text-[10px] text-on-surface-variant font-bold uppercase mt-1.5 tracking-widest">
          Workflow Steps
        </p>
      </div>

      <ul className="flex flex-col gap-1.5 w-full">
        {workflowSteps.map((step, idx) => {
          const stepNumber = idx + 1;
          const isActive = pathname === step.path;

          // STRICT GUARD: Directly uses canNavigateToStep function
          const isAllowed = canNavigateToStep(stepNumber);
          const isStep3Skipped = stepNumber === 3 && workflowMode === "file";

          return (
            <li key={step.path}>
              {isAllowed && !isStep3Skipped ? (
                <Link
                  href={step.path}
                  className={`flex items-center gap-3.5 px-4 py-3 rounded-xl font-semibold transition-all duration-150 ${
                    isActive
                      ? "bg-primary-container text-on-primary-container shadow-sm transform scale-[0.98]"
                      : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  }`}
                >
                  <span
                    className="material-symbols-outlined text-lg"
                    style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    {step.icon}
                  </span>
                  <span className="font-label-md text-sm">{step.label}</span>
                </Link>
              ) : (
                /* Disabled / Locked Step Sidebar Item */
                <div
                  className={`flex items-center justify-between px-4 py-3 rounded-xl font-semibold cursor-not-allowed opacity-40 select-none ${
                    isStep3Skipped ? "text-slate-500 line-through" : "text-on-surface-variant"
                  }`}
                  title={
                    isStep3Skipped
                      ? "Connect step skipped in File Import Mode"
                      : "Complete preceding steps to unlock"
                  }
                >
                  <div className="flex items-center gap-3.5">
                    <span className="material-symbols-outlined text-lg">
                      {isStep3Skipped ? "block" : step.icon}
                    </span>
                    <span className="font-label-md text-sm">
                      {isStep3Skipped ? "Connect (Skipped)" : step.label}
                    </span>
                  </div>
                  <span className="material-symbols-outlined text-sm">
                    {isStep3Skipped ? "block" : "lock"}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}