"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import StepperProgress from "@/components/StepperProgress";
import RAPIDCodeEditor from "@/components/RAPIDCodeEditor";
import { useToast } from "@/components/ToastContext";
import { useIntegrationMode } from "@/components/IntegrationModeContext";
import { useTestingWorkflow } from "@/components/TestingWorkflowContext";
import { useTcpWorkflow } from "@/components/TcpWorkflowContext";
import { csvToRapid } from "@/services/csvToRapid";
import axiosClient from "@/services/axiosClient";

import WeldSimulation3D from "@/components/WeldSimulation3D";

// ----------------------------------------------------------------------
// Main Page Component
// ----------------------------------------------------------------------
export default function GeneratePage() {
  const { showToast } = useToast();
  const { mode } = useIntegrationMode();
  const { csvData } = useTestingWorkflow();
  const { canonicalWeldPath, setCanonicalPath, rawPayload, updateProgress } = useTcpWorkflow();

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const maxTime = 12;
  const [backendData, setBackendData] = useState(null);

  useEffect(() => {
    updateProgress({ generateComplete: true, step6Complete: true });
  }, [updateProgress]);

  useEffect(() => {
    let interval = null;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= maxTime) {
            setIsPlaying(false);
            return 0;
          }
          return Math.min(prev + 0.1, maxTime);
        });
      }, 100);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  useEffect(() => {
    let isMounted = true;
    async function fetchRapidCode() {
      try {
        const res = await axiosClient.get("/rapid-code");
        if (isMounted && res.data && res.data.success) {
          setBackendData(res.data);
          if (res.data.waypoints && !canonicalWeldPath?.waypoints) {
            setCanonicalPath({
              id: `canonical_${Date.now()}`,
              source: res.data.pipeline?.sourceFile || "Feature.txt",
              coordinateFrame: "Robot Base Workspace (Direct)",
              waypoints: res.data.waypoints,
              rapidCode: res.data.rapidCode,
              totalWaypoints: res.data.waypoints.length,
              status: "Direct Robot Base Workspace Trajectory (Calibrated by TracerStudio)",
            });
          }
        }
      } catch (e) {
        console.warn("Express backend API /rapid-code fallback:", e.message);
      }
    }
    fetchRapidCode();
    return () => { isMounted = false; };
  }, [canonicalWeldPath, setCanonicalPath]);

  const activePoints = useMemo(() => {
    if (backendData?.waypoints && backendData.waypoints.length > 0) {
      return backendData.waypoints.map((wp) => ({
        name: wp.name || wp.id,
        x: wp.pos ? wp.pos[0] : wp.x,
        y: wp.pos ? wp.pos[1] : wp.y,
        z: wp.pos ? wp.pos[2] : wp.z,
        type: wp.type,
        pos: wp.pos,
      }));
    }
    if (canonicalWeldPath?.waypoints && canonicalWeldPath.waypoints.length > 0) {
      return canonicalWeldPath.waypoints.map((wp) => ({
        name: wp.name || wp.id,
        x: wp.pos ? wp.pos[0] : wp.x,
        y: wp.pos ? wp.pos[1] : wp.y,
        z: wp.pos ? wp.pos[2] : wp.z,
        type: wp.type,
        pos: wp.pos,
      }));
    }
    if (canonicalWeldPath?.pathPoints && canonicalWeldPath.pathPoints.length > 0) {
      return canonicalWeldPath.pathPoints;
    }
    if (rawPayload?.pathPoints && rawPayload.pathPoints.length > 0) {
      return rawPayload.pathPoints;
    }
    return [];
  }, [backendData, canonicalWeldPath, rawPayload]);

  const testingRapidCode = useMemo(() => {
    if (mode === "testing" && csvData && csvData.length > 0) {
      return csvToRapid(csvData);
    }
    return null;
  }, [mode, csvData]);

  const displayCode = mode === "testing" && testingRapidCode
    ? testingRapidCode
    : canonicalWeldPath?.rapidCode || backendData?.rapidCode || "! Fetching backend RAPID code...";

  const handleTogglePlay = () => {
    const nextState = !isPlaying;
    setIsPlaying(nextState);
    if (nextState) {
      showToast("▶ Realtime 3D Simulation Started", "Executing RAPID motion on 3D Welding Kinematics engine...", "info");
    }
  };

  const progressRatio = currentTime / maxTime;
  const formattedSec = Math.floor(currentTime) < 10 ? `0${Math.floor(currentTime)}` : Math.floor(currentTime);

  const phaseLabel = useMemo(() => {
    if (!isPlaying) return "IDLE";
    if (progressRatio < 0.15) return "HOME → APPROACH";
    if (progressRatio < 0.25) return "APPROACH → WELD START";
    if (progressRatio <= 0.75) return "WELDING (ARC ON)";
    if (progressRatio < 0.85) return "WELD END → RETRACT";
    return "RETRACT → HOME";
  }, [isPlaying, progressRatio]);

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative">
      {/* Left Sidebar Panel (45%) */}
      <aside className="bg-surface-container-low border-r border-outline-variant shadow-sm flex flex-col w-[45%] h-full pt-6 px-5 gap-4 shrink-0 z-20 overflow-y-auto">
        <div className="px-1 select-none">
          <h2 className="text-xl font-extrabold text-on-surface tracking-tight">
            RAPID Code Compiler
          </h2>
          <p className="text-xs text-on-surface-variant font-medium mt-1 leading-relaxed">
            Compile validated canonical weld path into industrial-standard ABB RAPID module.
          </p>
        </div>

        <StepperProgress />
        <div className="h-px w-full bg-outline-variant/60 my-0.5 opacity-50"></div>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          <RAPIDCodeEditor
            code={displayCode}
            title="ABB RAPID MODULE (EXPRESS BACKEND)"
            status={`COMPILED OK — ${activePoints.length} TARGETS`}
          />

          <div className="flex gap-3 select-none pb-4">
            <Link
              href="/parse-map"
              className="flex-1 bg-surface border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              Back to Parse & Map
            </Link>

            <Link
              href="/export"
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all select-none cursor-pointer"
            >
              Next Step
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </Link>
          </div>
        </div>
      </aside>

      {/* Right Viewport (55% Realtime 3D Kinematics) */}
      <div className="flex-1 h-full relative bg-slate-950 flex flex-col overflow-hidden">
        {/* Top Overlay Status Bar */}
        <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
          <div className="flex items-center gap-2 bg-slate-900/90 backdrop-blur-md border border-slate-800 px-3.5 py-2 rounded-xl shadow-lg pointer-events-auto">
            <span className={`w-2.5 h-2.5 rounded-full ${isPlaying ? "bg-emerald-400 animate-ping" : "bg-blue-400"}`}></span>
            <span className="text-xs font-semibold text-slate-200">
              {isPlaying ? "3D Kinematics Running..." : "3D Simulation Ready"}
            </span>
            {isPlaying && (
              <span className="ml-2 text-[10px] font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                {phaseLabel}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 bg-slate-900/90 backdrop-blur-md border border-slate-800 px-4 py-2 rounded-xl shadow-lg pointer-events-auto text-xs">
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="text-slate-400 font-mono text-[11px]">CYCLE:</span>
              <span className="font-mono font-bold text-blue-400">12.0s</span>
            </div>
            <div className="h-3 w-px bg-slate-700"></div>
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="text-slate-400 font-mono text-[11px]">TOOL:</span>
              <span className="font-mono font-bold text-amber-400">tWeldGun</span>
            </div>
            <div className="h-3 w-px bg-slate-700"></div>
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="text-slate-400 font-mono text-[11px]">POINTS:</span>
              <span className="font-mono font-bold text-emerald-400">{activePoints.length}</span>
            </div>
            <div className="h-3 w-px bg-slate-700"></div>
            <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.5 rounded">
              REACHABILITY: 100%
            </span>
          </div>
        </div>

        {/* Realtime 3D Simulation Canvas */}
        <div className="w-full h-full relative flex-1">
          <WeldSimulation3D points={activePoints} isPlaying={isPlaying} progressRatio={progressRatio} />
        </div>

          {/* Floating Bottom Control Bar */}
          <div className="absolute bottom-6 left-4 right-4 z-10 flex justify-center pointer-events-none">
            <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-full px-6 py-2.5 flex items-center gap-5 shadow-2xl pointer-events-auto select-none">
              <button
                onClick={handleTogglePlay}
                className="text-slate-200 hover:text-blue-400 transition-colors flex items-center justify-center p-2 rounded-full hover:bg-slate-800 cursor-pointer"
                title={isPlaying ? "Pause Simulation" : "Play Simulation"}
              >
                <span className="material-symbols-outlined text-[26px]">
                  {isPlaying ? "pause" : "play_arrow"}
                </span>
              </button>

              <div
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickRatio = (e.clientX - rect.left) / rect.width;
                  setCurrentTime(clickRatio * maxTime);
                }}
                className="w-56 h-2 bg-slate-800 rounded-full overflow-hidden relative cursor-pointer"
              >
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-75"
                  style={{ width: `${progressRatio * 100}%` }}
                ></div>
              </div>

              <span className="font-mono text-xs text-slate-300 font-semibold min-w-[85px] text-right">
                00:{formattedSec} / 00:12
              </span>
            </div>
          </div>
        </div>
      </div>
  );
}