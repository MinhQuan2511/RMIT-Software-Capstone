"use client";

import React from "react";
import { useRouter, usePathname } from "next/navigation";
import { useIntegrationMode } from "./IntegrationModeContext";
import { useTcpWorkflow } from "./TcpWorkflowContext";

export default function StepperProgress() {
  const router = useRouter();
  const pathname = usePathname();
  const { workflowSteps } = useIntegrationMode();
  const { canNavigateToStep, workflowMode } = useTcpWorkflow();

  const activeIndex = workflowSteps.findIndex((s) => s.path === pathname);

  const handleStepClick = (path, stepNumber) => {
    if (canNavigateToStep(stepNumber)) {
      router.push(path);
    }
  };

  return (
    <div className="w-full py-3 px-0 overflow-visible">
      <div className="flex items-center justify-between relative select-none w-full gap-1">
        {workflowSteps.map((step, idx) => {
          const stepNumber = idx + 1;
          const isCompleted = idx < activeIndex;
          const isActive = idx === activeIndex;

          // STRICT GUARD: Directly uses canNavigateToStep function
          const isAllowed = canNavigateToStep(stepNumber);
          const isStep3Skipped = stepNumber === 3 && workflowMode === "file";

          return (
            <React.Fragment key={step.path}>
              {/* Step Circle Button */}
              <button
                onClick={() => handleStepClick(step.path, stepNumber)}
                disabled={!isAllowed || isStep3Skipped}
                className={`flex flex-col items-center gap-1.5 focus:outline-none shrink-0 transition-all relative z-20 ${
                  isAllowed && !isStep3Skipped
                    ? "hover:scale-105 active:scale-95 cursor-pointer"
                    : "cursor-not-allowed opacity-50"
                }`}
                type="button"
                title={
                  isStep3Skipped
                    ? "Connect step skipped in File Import Mode"
                    : isAllowed
                    ? `Go to ${step.label}`
                    : "Complete preceding steps to unlock"
                }
              >
                {/* Step Circle Indicator */}
                {isStep3Skipped ? (
                  <div className="w-8 h-8 rounded-full bg-slate-800 text-slate-500 border border-slate-700 flex items-center justify-center font-bold text-xs shrink-0 shadow-inner">
                    <span className="material-symbols-outlined text-[14px]">block</span>
                  </div>
                ) : isCompleted ? (
                  <div className="w-8 h-8 rounded-full bg-blue-400 text-white flex items-center justify-center font-bold text-xs shadow-sm shrink-0 border border-blue-300 hover:bg-blue-500 transition-all">
                    <span className="material-symbols-outlined text-[16px] font-bold">check</span>
                  </div>
                ) : isActive ? (
                  <div className="w-9 h-9 rounded-full bg-blue-600 text-white border-2 border-white flex items-center justify-center font-extrabold text-[14px] shadow-lg shrink-0 ring-2 ring-blue-300">
                    {stepNumber}
                  </div>
                ) : isAllowed ? (
                  <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 border border-slate-300 flex items-center justify-center font-bold text-xs shrink-0 hover:bg-blue-500 hover:text-white transition-all">
                    {stepNumber}
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-full bg-slate-200/60 text-slate-400 border border-slate-300/50 flex items-center justify-center font-bold text-xs shrink-0">
                    <span className="material-symbols-outlined text-[14px]">lock</span>
                  </div>
                )}

                {/* Step Label */}
                <span
                  className={`stepper-label text-[10px] tracking-wide text-center leading-tight font-medium transition-all duration-150 whitespace-nowrap ${
                    isStep3Skipped
                      ? "text-slate-600 line-through"
                      : isActive
                      ? "font-bold text-blue-600"
                      : isCompleted
                      ? "font-semibold text-blue-500"
                      : isAllowed
                      ? "text-slate-600 font-semibold"
                      : "text-slate-400"
                  }`}
                >
                  {isStep3Skipped ? "Connect (Skipped)" : step.label}
                </span>
              </button>

              {/* Connecting Line */}
              {idx < workflowSteps.length - 1 && (
                <div
                  className={`flex-1 h-[2px] mx-0.5 -translate-y-[10px] -z-10 shrink-0 transition-colors ${
                    isStep3Skipped || (idx === 1 && workflowMode === "file")
                      ? "bg-slate-700 border-dashed border-t border-slate-600 h-0"
                      : isCompleted
                      ? "bg-blue-400"
                      : "bg-slate-300"
                  }`}
                ></div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}