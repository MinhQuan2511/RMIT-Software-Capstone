"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StepperProgress from "@/components/StepperProgress";
import Active3DViewport from "@/components/Active3DViewport";
import { useToast } from "@/components/ToastContext";
import { tracerStudioApi } from "@/services/tracerStudioApi";

export default function CalibratePage() {
  const router = useRouter();
  const { showToast } = useToast();
  
  // Form input states
  const [targetType, setTargetType] = useState("ChArUco Board");
  const [squareSize, setSquareSize] = useState("30.0");
  const [tcpX, setTcpX] = useState("0.00");
  const [tcpY, setTcpY] = useState("150.00");
  const [tcpZ, setTcpZ] = useState("45.50");
  const [tcpRx, setTcpRx] = useState("90.0");
  const [tcpRy, setTcpRy] = useState("0.0");
  const [tcpRz, setTcpRz] = useState("-90.0");

  const [calibrating, setCalibrating] = useState(false);
  const [isCalibrated, setIsCalibrated] = useState(false);

  const handleGenerateRoutine = async () => {
    setCalibrating(true);
    showToast(
      "🔄 Initializing Hand-Eye Calibration",
      "Generating RAPID calibration trajectory paths...",
      "info"
    );

    try {
      const tcp = { x: tcpX, y: tcpY, z: tcpZ, rx: tcpRx, ry: tcpRy, rz: tcpRz };
      const res = await tracerStudioApi.triggerCalibration(targetType, squareSize, tcp);
      
      if (res.success) {
        setIsCalibrated(true);
        showToast(
          "✓ Calibration Routine Compiled",
          `Captured ${res.pointsCaptured} calibration points. Reprojection Error: ${res.reprojectionError} mm.`,
          "success"
        );
      }
    } catch (e) {
      console.error(e);
      showToast("❌ Calibration Error", "Failed to compile hand-eye calibration routine.", "error");
    } finally {
      setCalibrating(false);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative">
      {/* Left Sidebar Panel (45%) */}
      <aside className="bg-surface-container-low border-r border-outline-variant shadow-sm flex flex-col w-[45%] h-full pt-6 px-5 gap-4 shrink-0 z-40 overflow-y-auto">
        <div className="px-1 select-none">
          <h2 className="text-xl font-extrabold text-on-surface tracking-tight">
            Automated Hand-Eye Calibration Wizard
          </h2>
          <p className="text-xs text-on-surface-variant font-medium mt-1.5 leading-relaxed">
            Configure and execute the calibration routine to align the robot's coordinate system with the 3D scanner.
          </p>
        </div>

        {/* Dynamic Workflow Progress Stepper */}
        <StepperProgress />

        <div className="h-px w-full bg-outline-variant/60 my-1 opacity-50"></div>

        {/* Calibration Controls */}
        <div className="flex-1 flex flex-col gap-5 pb-6">
          {/* Target Settings Card */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">center_focus_strong</span>
              Calibration Target Definition
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Target Type
                </label>
                <select
                  value={targetType}
                  onChange={(e) => setTargetType(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs text-on-surface font-semibold focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary appearance-none cursor-pointer"
                >
                  <option>ChArUco Board</option>
                  <option>Checkerboard</option>
                  <option>Circle Grid</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Square Size (mm)
                </label>
                <input
                  type="number"
                  value={squareSize}
                  onChange={(e) => setSquareSize(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs font-mono text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* TCP Settings Card */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">precision_manufacturing</span>
              Tool Center Point (TCP) Offset
            </h3>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block font-mono text-[10px] text-on-surface-variant mb-1">X (mm)</label>
                <input
                  type="number"
                  value={tcpX}
                  onChange={(e) => setTcpX(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-2.5 py-1.5 font-mono text-xs text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] text-on-surface-variant mb-1">Y (mm)</label>
                <input
                  type="number"
                  value={tcpY}
                  onChange={(e) => setTcpY(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-2.5 py-1.5 font-mono text-xs text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] text-on-surface-variant mb-1">Z (mm)</label>
                <input
                  type="number"
                  value={tcpZ}
                  onChange={(e) => setTcpZ(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-2.5 py-1.5 font-mono text-xs text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-mono text-[10px] text-on-surface-variant mb-1">Rx (deg)</label>
                <input
                  type="number"
                  value={tcpRx}
                  onChange={(e) => setTcpRx(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-2.5 py-1.5 font-mono text-xs text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] text-on-surface-variant mb-1">Ry (deg)</label>
                <input
                  type="number"
                  value={tcpRy}
                  onChange={(e) => setTcpRy(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-2.5 py-1.5 font-mono text-xs text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] text-on-surface-variant mb-1">Rz (deg)</label>
                <input
                  type="number"
                  value={tcpRz}
                  onChange={(e) => setTcpRz(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-2.5 py-1.5 font-mono text-xs text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
            </div>
          </div>

          {/* Action Trigger Buttons */}
          <div className="mt-auto flex flex-col gap-4">
            <button
              onClick={handleGenerateRoutine}
              disabled={calibrating}
              className="w-full bg-primary hover:bg-surface-tint text-on-primary rounded-xl p-4 flex flex-col items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-sm cursor-pointer border border-transparent disabled:opacity-50 disabled:cursor-not-allowed group select-none"
            >
              <div className="flex items-center gap-2">
                <span className={`material-symbols-outlined text-[24px] ${calibrating ? "animate-spin" : "group-hover:rotate-180 transition-transform duration-500"}`}>
                  sync
                </span>
                <span className="font-extrabold text-sm uppercase tracking-wider">
                  {calibrating ? "Generating Trajectory..." : "Generate Calibration Routine"}
                </span>
              </div>
              <span className="text-[10px] text-on-primary/75 text-center max-w-[85%] font-medium leading-normal">
                Generates custom RAPID routine to move and rotate the robot wrist around the calibration target board.
              </span>
            </button>

            <div className="flex gap-4">
              {/* Explicit Back Button to previous step */}
              <Link
                href="/projects"
                className="flex-1 bg-surface border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-xl py-3 font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm select-none"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                &lt; Back to Workspace
              </Link>
              
              <button
                onClick={() => router.push("/configure")}
                disabled={!isCalibrated}
                className={`flex-1 rounded-xl py-3 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all select-none ${
                  isCalibrated
                    ? "bg-primary text-on-primary hover:bg-surface-tint cursor-pointer"
                    : "bg-surface-variant border border-outline-variant text-on-surface-variant opacity-40 cursor-not-allowed"
                }`}
              >
                Next Step
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Right Viewport (55%) */}
      <div className="flex-1 h-full relative">
        <Active3DViewport title="Calibration Hub Visualizer [ABB Robot Hand-Eye]">
          {({ pointCloudActive }) => (
            isCalibrated ? (
              // Active simulation state render
              <div className="relative w-full h-full flex flex-col justify-center items-center">
                <div className="absolute inset-0 bg-[#000]/10 rounded-xl overflow-hidden flex flex-col justify-center items-center pointer-events-none">
                  {pointCloudActive && (
                    <div className="absolute w-[260px] h-[260px] border border-primary/40 rounded-full animate-ping opacity-10"></div>
                  )}
                  {/* Mock wireframe path rendering */}
                  <svg className="w-80 h-80 text-primary opacity-80" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="3 3" />
                    <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" strokeWidth="1" />
                    <line x1="50" y1="10" x2="50" y2="90" stroke="currentColor" strokeWidth="0.5" />
                    <line x1="10" y1="50" x2="90" y2="50" stroke="currentColor" strokeWidth="0.5" />
                    <circle cx="50" cy="50" r="2" fill="currentColor" />
                    <path d="M 30,50 L 50,30 L 70,50 L 50,70 Z" fill="none" stroke="#ba1a1a" strokeWidth="1.5" className="animate-pulse" />
                  </svg>
                  <div className="absolute bottom-16 bg-surface/90 backdrop-blur-sm border border-outline-variant px-4 py-2 rounded-lg text-center text-xs font-bold text-on-surface select-none shadow-sm pointer-events-auto">
                    🚀 Calibration Trajectory Loaded: 12 TCP poses defined.
                  </div>
                </div>
              </div>
            ) : null
          )}
        </Active3DViewport>
      </div>
    </div>
  );
}
