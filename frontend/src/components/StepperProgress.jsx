"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIntegrationMode } from "./IntegrationModeContext";

export default function StepperProgress() {
  const pathname = usePathname();
  const { workflowSteps } = useIntegrationMode();
  const activeIndex = workflowSteps.findIndex((s) => s.path === pathname);

  // Determine if we need compressed mode for many steps
  const isCompressed = workflowSteps.length > 6;

  return (
    <div className={`mb-8 px-2 flex items-center justify-between relative select-none w-full ${isCompressed ? 'max-w-2xl' : 'max-w-xl'} mx-auto overflow-x-auto`}>
      {/* Background Connecting Line */}
      <div className="absolute left-0 top-[18px] w-full h-[2px] bg-outline-variant/60 -z-10"></div>

      {workflowSteps.map((step, idx) => {
        const isCompleted = idx < activeIndex;
        const isActive = idx === activeIndex;

        return (
          <React.Fragment key={step.path}>
            {/* Step Node */}
            <Link 
              href={step.path}
              className="stepper-step flex flex-col items-center gap-1.5 focus:outline-none shrink-0"
            >
              {isCompleted ? (
                // Completed State
                <div className="stepper-circle w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold text-xs shadow-sm shrink-0 hover:bg-primary-container transition-colors">
                  <span className="material-symbols-outlined text-[15px] font-bold">check</span>
                </div>
              ) : isActive ? (
                // Active State
                <div className="stepper-circle w-9 h-9 rounded-full bg-primary text-on-primary border-2 border-surface-container-low flex items-center justify-center font-extrabold text-[14px] shadow-md shrink-0">
                  {idx + 1}
                </div>
              ) : (
                // Upcoming State
                <div className="stepper-circle w-8 h-8 rounded-full bg-surface-container-high border border-outline-variant text-on-surface-variant flex items-center justify-center font-bold text-xs shrink-0 hover:border-primary/60 transition-colors">
                  {idx + 1}
                </div>
              )}

              {/* Step Label */}
              <span
                className={`stepper-label text-[10px] sm:text-[11px] tracking-wide mt-0.5 text-center leading-tight transition-all duration-150 ${
                  isActive
                    ? "font-extrabold text-primary"
                    : isCompleted
                    ? "font-semibold text-primary/80"
                    : "font-semibold text-on-surface-variant/70"
                }`}
              >
                {step.label}
              </span>
            </Link>

            {/* Connecting line between steps */}
            {idx < workflowSteps.length - 1 && (
              <div
                className={`flex-1 h-[2.5px] mx-1 -translate-y-[10px] -z-10 shrink-0 ${
                  isCompleted ? "bg-primary" : "bg-outline-variant/60"
                }`}
              ></div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
