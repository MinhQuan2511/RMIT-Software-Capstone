"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import StepperProgress from "@/components/StepperProgress";
import Active3DViewport from "@/components/Active3DViewport";
import RAPIDCodeEditor from "@/components/RAPIDCodeEditor";
import { useToast } from "@/components/ToastContext";
import { useIntegrationMode } from "@/components/IntegrationModeContext";
import { useTestingWorkflow } from "@/components/TestingWorkflowContext";
import { csvToRapid } from "@/services/csvToRapid";

const MOCK_RAPID_CODE = `MODULE CalibModule
  CONST robtarget p_home := [[500,0,500],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget p1 := [[450.5,12.2,400.1],[0.99,0.01,-0.1,0.05],[0,-1,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget p2 := [[472.1,35.4,395.2],[0.98,0.02,-0.1,0.05],[0,-1,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  PERS tooldata tWeld := [TRUE,[[0,0,120],[1,0,0,0]],[1.2,[0,0,40],[1,0,0,0],0,0,0]];

  PROC rMainCalib()
    MoveJ p_home, v500, fine, tWeld;
    
    ! Calibration wrist movements
    MoveL p1, v100, fine, tWeld;
    MoveL p2, v100, fine, tWeld;

    ! Retract sequence
    MoveL Offs(p2, 0, 0, 50), v200, z10, tWeld;
    MoveJ p_home, v500, z50, tWeld;
  ENDPROC
ENDMODULE`;

export default function GeneratePage() {
  const { showToast } = useToast();
  const { mode } = useIntegrationMode();
  const { csvData } = useTestingWorkflow();
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(30);

  // Generate RAPID code from CSV when in testing mode
  const testingRapidCode = useMemo(() => {
    if (mode === "testing" && csvData && csvData.length > 0) {
      return csvToRapid(csvData);
    }
    return null;
  }, [mode, csvData]);

  // Choose the right code to display
  const displayCode = mode === "testing" && testingRapidCode
    ? testingRapidCode
    : MOCK_RAPID_CODE;

  const handleTogglePlay = () => {
    setIsPlaying(!isPlaying);
    if (!isPlaying) {
      showToast(
        "▶ Simulating Path Trajectory",
        "Executing RAPID program simulation inside RobotStudio sandbox environment...",
        "info"
      );
    }
  };

  // Mode-aware subtitle
  let subtitle;
  if (mode === "testing") {
    subtitle = csvData && csvData.length > 0
      ? `Generating RAPID code from ${csvData.length} CSV welding coordinates. Review the compiled module below.`
      : "No CSV data loaded. Please go back to the Upload step first.";
  } else if (mode === "tcp") {
    subtitle = "Compile the validated canonical weld path received through the TCP bridge into an industrial-standard ABB RAPID module.";
  } else {
    subtitle = "Compile the filtered point cloud points and configurations into industrial-standard ABB RAPID modules.";
  }

  // Mode-aware back link
  const backHref = mode === "testing" ? "/testing-preview" : "/preview";
  const backLabel = mode === "testing" ? "< Back to Preview Path" : "< Back to Preview";

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative">
      {/* Left Sidebar Panel (45%) */}
      <aside className="bg-surface-container-low border-r border-outline-variant shadow-sm flex flex-col w-[45%] h-full pt-6 px-5 gap-4 shrink-0 z-40 overflow-y-auto">
        <div className="px-1 select-none">
          <h2 className="text-xl font-extrabold text-on-surface tracking-tight">
            RAPID Code Compiler
          </h2>
          <p className="text-xs text-on-surface-variant font-medium mt-1.5 leading-relaxed">
            {subtitle}
          </p>
        </div>

        {/* Dynamic Workflow Progress Stepper */}
        <StepperProgress />

        <div className="h-px w-full bg-outline-variant/60 my-1 opacity-50"></div>

        {/* Code Output panel */}
        <div className="flex-1 flex flex-col gap-4 min-h-0">
          <RAPIDCodeEditor 
            code={displayCode} 
            title={mode === "testing" ? "ABB RAPID MODULE — CSV GENERATED" : "ABB RAPID MODULE PREVIEW"} 
            status={mode === "testing" && testingRapidCode ? `COMPILED OK — ${csvData.length} POINTS` : "COMPILED OK"} 
          />
          
          <div className="flex gap-4 select-none pb-4">
            <Link
              href={backHref}
              className="flex-1 bg-surface border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              {backLabel}
            </Link>
            
            <Link
              href="/export"
              className="flex-1 bg-primary text-on-primary hover:bg-surface-tint rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all select-none cursor-pointer"
            >
              Next Step
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </Link>
          </div>
        </div>
      </aside>

      {/* Right Viewport (55%) */}
      <div className="flex-1 h-full relative bg-inverse-surface">
        <Active3DViewport 
          title="RobotStudio Simulated Environment [RAPID Path Preview]"
          backgroundImage="https://lh3.googleusercontent.com/aida-public/AB6AXuDDbF07X3Jik5nc9MGAhDntHdmlivK9CMdZbKwXT7W8_5ur6s9rnvLs7Yq2uwL1xI1Qn5LUH5848Lr2U_K15vbHUllRCd8pS6y3WuOy-ISXdWMGMAhw9P27h4WU0Pk9gnrhKlf5Vo1qlrVoaIc1HQvyoG-V-siBuU-37MPJ5NsNF8-WyiVROCKkZIGfppfYdfHpels5axnyR7J4RqB7_Twmtbe655GpuxW-eqqr0l3fJtT0GBAbT0f2ymhX7CdVnBPGDfQY9jVBSrs"
          showLiveBadge={true}
          showSolidControls={true}
          showSimControls={true}
        >
          {/* Custom overlays for preview simulation control overlay */}
          {() => (
            <div className="absolute inset-0 w-full h-full flex flex-col justify-end">
              <div className="absolute bottom-6 left-4 right-4 z-10 flex justify-center pointer-events-none">
                <div className="bg-surface/90 backdrop-blur-sm border border-outline-variant rounded-full px-5 py-2.5 flex items-center gap-4 shadow-lg pointer-events-auto select-none">
                  <button 
                    onClick={handleTogglePlay}
                    className="text-on-surface hover:text-primary transition-colors flex items-center justify-center p-1.5 rounded-full hover:bg-surface-container-high cursor-pointer"
                  >
                    <span className="material-symbols-outlined fill-icon text-[24px]">
                      {isPlaying ? "pause" : "play_arrow"}
                    </span>
                  </button>
                  <div className="w-48 h-1 bg-surface-container-highest rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    ></div>
                  </div>
                  <span className="font-mono text-xs text-on-surface-variant font-semibold">
                    00:03 / 00:12
                  </span>
                </div>
              </div>
            </div>
          )}
        </Active3DViewport>
      </div>
    </div>
  );
}
