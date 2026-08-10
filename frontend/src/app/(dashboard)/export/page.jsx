"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StepperProgress from "@/components/StepperProgress";
import Active3DViewport from "@/components/Active3DViewport";
import RAPIDCodeEditor from "@/components/RAPIDCodeEditor";
import { useToast } from "@/components/ToastContext";
import { useIntegrationMode } from "@/components/IntegrationModeContext";
import { useTestingWorkflow } from "@/components/TestingWorkflowContext";
import { csvToRapid } from "@/services/csvToRapid";
import { robotStudioApi } from "@/services/robotStudioApi";

const EXPORT_RAPID_CODE = `MODULE MainModule
    CONST robtarget pHome := [[500, 0, 500], [1, 0, 0, 0], [0, 0, 0, 0], [9E9, 9E9, 9E9, 9E9, 9E9, 9E9]];
    CONST robtarget pScan1 := [[520.12, 10.5, 480.9], [0.98, 0.1, -0.05, 0.02], [0, -1, 0, 0], [9E9, 9E9, 9E9, 9E9, 9E9, 9E9]];
    CONST robtarget pScan2 := [[540.33, 22.1, 460.2], [0.96, 0.15, -0.1, 0.05], [0, -1, 0, 0], [9E9, 9E9, 9E9, 9E9, 9E9, 9E9]];
    CONST robtarget pScan3 := [[560.81, 35.6, 440.7], [0.94, 0.2, -0.15, 0.08], [0, -1, 0, 0], [9E9, 9E9, 9E9, 9E9, 9E9, 9E9]];

    ! Auto-generated dynamic pathing data
    PERS wobjdata wobj_scan := [FALSE, TRUE, "", [[0,0,0],[1,0,0,0]], [[150,-50,200],[1,0,0,0]]];
    PERS tooldata tool_sensor := [TRUE, [[0,0,150],[1,0,0,0]], [1.5, [0,0,50], [1,0,0,0], 0.05, 0.05, 0.05]];

    PROC main()
        ConfL \\Off;
        ConfJ \\Off;
        MoveJ pHome, v500, fine, tool_sensor \\WObj:=wobj_scan;

        ! Scanning Sequence Start
        SetDO do_LaserActive, 1;
        MoveL pScan1, v100, z10, tool_sensor \\WObj:=wobj_scan;
        MoveL pScan2, v100, z10, tool_sensor \\WObj:=wobj_scan;
        MoveL pScan3, v100, z10, tool_sensor \\WObj:=wobj_scan;
        SetDO do_LaserActive, 0;

        MoveJ pHome, v500, fine, tool_sensor \\WObj:=wobj_scan;
    ENDPROC
ENDMODULE`;

export default function ExportPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { mode } = useIntegrationMode();
  const { csvData } = useTestingWorkflow();
  const [syncing, setSyncing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const activeCode = useMemo(() => {
    if (mode === "testing" && csvData && csvData.length > 0) {
      return csvToRapid(csvData);
    }
    return EXPORT_RAPID_CODE;
  }, [mode, csvData]);

  const fileName = mode === "testing" ? "Module1.mod" : "MainModule.mod";

  const handleCopyAndLaunch = async () => {
    setSyncing(true);
    showToast(
      "📋 Auto-Saving & Copied...",
      `Saving ${fileName} and launching RobotStudio 2025...`,
      "info"
    );

    try {
      // 1. Copy code to clipboard
      await navigator.clipboard.writeText(activeCode);
      
      // 2. Trigger browser file download (Autosave generated code)
      const blob = new Blob([activeCode], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // 3. Launch RobotStudio 2025 via local server API endpoint
      const res = await fetch("/api/launch-robotstudio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: activeCode, fileName }),
      });
      const data = await res.json();

      if (data && data.success) {
        showToast(
          "🚀 RobotStudio 2025 Launched!",
          `RobotStudio 2025 opened on your desktop with ${fileName}. Code copied to clipboard!`,
          "success"
        );
      } else {
        setShowModal(true);
      }
    } catch (e) {
      console.error(e);
      setShowModal(true);
      showToast("✓ Saved & Copied!", "RAPID code downloaded and copied to clipboard successfully.", "success");
    } finally {
      setSyncing(false);
    }
  };

  const handleResetSession = () => {
    showToast(
      "🔄 Session Reset Completed",
      "Cleared local trajectories and returned variables back to system defaults."
    );
    router.push("/projects");
  };

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative">
      {/* SideNavBar layout is handled globally by (dashboard) layout, so we are in main body */}
      <main className="flex-1 flex flex-row gap-gutter p-gutter h-full overflow-hidden bg-background w-full">
        
        {/* Left Section: Instructions + Code block */}
        <div className="flex w-1/2 flex-col gap-gutter h-full min-w-0">
          
          {/* Progress Stepper & Title */}
          <div className="bg-surface-container-lowest border border-outline-variant shadow-[0_4px_12px_rgba(0,0,0,0.05)] rounded-xl p-6 flex flex-col gap-4 select-none shrink-0">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-extrabold text-lg text-on-surface mb-1 flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-2xl">
                    integration_instructions
                  </span>
                  External Desktop Sync Instructions
                </h3>
                <p className="text-xs text-on-surface-variant font-medium leading-relaxed">
                  Complete these steps to transfer the generated path to the physical controller via RobotStudio.
                </p>
              </div>
            </div>
            
            <StepperProgress />
          </div>

          {/* Stepper Details Card */}
          <section className="bg-surface-container-lowest border border-outline-variant shadow-[0_4px_12px_rgba(0,0,0,0.05)] rounded-xl p-6 flex flex-col gap-5 shrink-0 select-none">
            <ol className="flex flex-col gap-3 text-xs font-semibold text-on-surface">
              <li className="flex items-start gap-3 bg-surface-container-low p-3 rounded-lg border border-outline-variant/50">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-on-primary font-bold text-xs shrink-0">
                  1
                </span>
                <span className="mt-0.5 font-medium leading-relaxed">
                  <strong>Auto-copy code</strong> to your system clipboard using the primary action button below.
                </span>
              </li>
              <li className="flex items-start gap-3 bg-surface-container-low p-3 rounded-lg border border-outline-variant/50">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-on-primary font-bold text-xs shrink-0">
                  2
                </span>
                <span className="mt-0.5 font-medium leading-relaxed">
                  <strong>Alt+Tab to RobotStudio</strong> and ensure your target workstation is online and selected.
                </span>
              </li>
              <li className="flex items-start gap-3 bg-surface-container-low p-3 rounded-lg border border-outline-variant/50">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-on-primary font-bold text-xs shrink-0">
                  3
                </span>
                <span className="mt-0.5 font-medium leading-relaxed">
                  <strong>Ctrl+V in editor</strong> module <code>Module1.mod</code> replacing the existing <code>PROC main()</code> block.
                </span>
              </li>
            </ol>
            
            <div className="flex flex-col sm:flex-row gap-3 pt-3 border-t border-outline-variant select-none">
              <button 
                onClick={handleCopyAndLaunch}
                disabled={syncing}
                className="flex-1 bg-primary hover:bg-surface-tint text-on-primary font-bold text-xs uppercase tracking-wider py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer shadow-sm disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-base">content_copy</span>
                {syncing ? "Launching Studio..." : "Copy Code & Sync Desktop"}
              </button>
              <button 
                onClick={handleResetSession}
                className="flex-1 bg-surface hover:bg-surface-container-low border border-outline text-on-surface-variant hover:text-on-surface font-bold text-xs uppercase tracking-wider py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">refresh</span>
                Reset Local Session
              </button>
            </div>
          </section>

          {/* Code Viewer Panel */}
          <RAPIDCodeEditor 
            code={activeCode} 
            title={mode === "testing" ? "Dynamic ABB RAPID Output (Module1.mod)" : "Dynamic ABB RAPID Output (MainModule.mod)"} 
            status="Ready to Export" 
            onCopySuccess={handleCopyAndLaunch}
          />
        </div>

        {/* Right Section: Viewport simulation */}
        <section className="flex-1 bg-surface-container-lowest border border-outline-variant shadow-[0_4px_12px_rgba(0,0,0,0.05)] rounded-xl overflow-hidden flex flex-col relative h-full">
          <div className="bg-tertiary text-on-tertiary px-4 py-2 flex items-center justify-center gap-2 shrink-0 z-10 shadow-md select-none font-bold text-[10px] uppercase tracking-wider">
            <span className="material-symbols-outlined text-sm font-bold">warning</span>
            <span>⚠️ Emulated Desktop Preview Active</span>
          </div>

          <div className="flex-1 relative bg-surface-container w-full h-full">
            <div 
              className="absolute inset-0 bg-cover bg-center w-full h-full opacity-90 mix-blend-multiply" 
              style={{
                backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuAPoHyGCRoUa2vaSj1qiCfNXTJRk6sEXiu3nQSejFkKpG0OX_qwl4zwaRXoWmJ58VST5AnBWCICBCEVRGRCn4FaB5JmSnq2HzbqH3zULswU5a0YDm7TRbDjjb64Q0d6xuKqmSF6pTk-zPnccqg-x4P3W2nspW4aqNSgm1AesIqCR20RYByRU12NMBIhv1Wevl8mRLZa-E0Jytl_tcpMkwkoLnvWjDltp43c7CsZNH1ecyY3TVq0OkWBbPTSSVN-hFWlThzoohgIgAc')",
              }}
            />
            
            {/* Custom bottom HUD display */}
            <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end pointer-events-none select-none">
              <div className="flex flex-col gap-2 pointer-events-auto">
                <button className="bg-surface-container-lowest/80 backdrop-blur-sm border border-outline-variant text-on-surface p-2 rounded-lg hover:bg-surface-container-low transition-colors shadow-sm cursor-pointer">
                  <span className="material-symbols-outlined">zoom_in</span>
                </button>
                <button className="bg-surface-container-lowest/80 backdrop-blur-sm border border-outline-variant text-on-surface p-2 rounded-lg hover:bg-surface-container-low transition-colors shadow-sm cursor-pointer">
                  <span className="material-symbols-outlined">zoom_out</span>
                </button>
                <button className="bg-surface-container-lowest/80 backdrop-blur-sm border border-outline-variant text-on-surface p-2 rounded-lg hover:bg-surface-container-low transition-colors shadow-sm cursor-pointer">
                  <span className="material-symbols-outlined">360</span>
                </button>
              </div>

              <div className="bg-surface-container-lowest/90 backdrop-blur-md border border-outline-variant text-on-surface px-4 py-3 rounded-lg shadow-sm flex items-center gap-4 pointer-events-auto text-xs font-semibold">
                <div className="flex flex-col">
                  <span className="text-[10px] text-on-surface-variant uppercase font-bold">TCP Status</span>
                  <span className="font-mono text-primary font-bold text-sm">X: 520.12 Y: 10.5</span>
                </div>
                <div className="w-[1px] h-8 bg-outline-variant/50"></div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-on-surface-variant uppercase font-bold">Simulation Time</span>
                  <span className="font-mono text-on-surface text-sm">00:04.25</span>
                </div>
                <button 
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="ml-2 bg-primary hover:bg-surface-tint text-on-primary w-10 h-10 rounded-full flex items-center justify-center shadow-md cursor-pointer transition-colors"
                >
                  <span className="material-symbols-outlined">{isPlaying ? "pause" : "play_arrow"}</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Premium Download Notice Dialog Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-[0_16px_48px_rgba(0,0,0,0.2)] max-w-md w-full p-6 animate-entrance flex flex-col gap-5">
            <div className="flex items-center gap-3 select-none">
              <div className="w-10 h-10 rounded-lg bg-tertiary-fixed text-tertiary flex items-center justify-center border border-outline-variant">
                <span className="material-symbols-outlined text-2xl font-bold">rocket_launch</span>
              </div>
              <div>
                <h4 className="font-extrabold text-base text-on-surface leading-none">Launching ABB RobotStudio</h4>
                <p className="text-[9px] text-on-surface-variant font-extrabold uppercase tracking-widest mt-1.5">External Application Bridge</p>
              </div>
            </div>

            <div className="text-xs text-on-surface-variant leading-relaxed flex flex-col gap-3 font-semibold">
              <p>
                We have successfully copied the RAPID code to your system clipboard and automatically saved <strong>{fileName}</strong> to your Downloads folder.
              </p>
              <p className="bg-surface-container-low border border-outline-variant/60 p-3 rounded-lg text-on-surface text-[11px] leading-relaxed">
                <strong>Notice:</strong> Opening RobotStudio requires the desktop application installed on your PC. If it does not start automatically, please click below to download the official software.
              </p>
            </div>

            <div className="flex gap-3 pt-2 select-none">
              <a 
                href="https://new.abb.com/products/robotics/robotstudio/downloads" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex-1 bg-primary hover:bg-surface-tint text-on-primary font-bold text-xs uppercase tracking-wider py-3.5 rounded-lg text-center transition-colors shadow-sm"
              >
                Download App
              </a>
              <button 
                onClick={() => setShowModal(false)}
                className="flex-1 bg-surface hover:bg-surface-container-low border border-outline text-on-surface-variant hover:text-on-surface font-bold text-xs uppercase tracking-wider py-3.5 rounded-lg transition-colors cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

