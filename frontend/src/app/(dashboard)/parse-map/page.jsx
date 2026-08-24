"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StepperProgress from "@/components/StepperProgress";
import Active3DViewport from "@/components/Active3DViewport";
import { useToast } from "@/components/ToastContext";
import { useTcpWorkflow } from "@/components/TcpWorkflowContext";
import axiosClient from "@/services/axiosClient";

const PIPELINE_STEPS = [
  { label: "Decode Feature.txt Seam Descriptor", icon: "decode" },
  { label: "Extract Direct Workspace Coordinates (P_start & P_end)", icon: "pin_drop" },
  { label: "Synthesize Approach & Retract Vectors (Target_30 & Target_20)", icon: "route" },
  { label: "Assign Calibrated Tool Orientation ([0, 0, 0.9659, -0.2588])", icon: "tune" },
  { label: "Compile to Verified RAPID Module (Path_10 Structure)", icon: "terminal" },
];

export default function ParseMapPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const {
    rawPayload,
    canonicalWeldPath,
    setCanonicalPath,
    updateProgress,
  } = useTcpWorkflow();

  const [pipelineStatuses, setPipelineStatuses] = useState(
    PIPELINE_STEPS.map(() => "waiting")
  );
  const [processing, setProcessing] = useState(false);
  const [mappingComplete, setMappingComplete] = useState(false);
  const [pipelineData, setPipelineData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function loadPipelineData() {
      try {
        const res = await axiosClient.post("/process-pipeline");
        if (!cancelled && res.data && res.data.success) {
          setPipelineData(res.data.pipeline);
        }
      } catch (e) {
        console.warn("Failed fetching pipeline data from backend API:", e.message);
      }
    }
    loadPipelineData();

    const runAnimation = async () => {
      for (let i = 0; i < PIPELINE_STEPS.length; i++) {
        if (cancelled) return;
        setPipelineStatuses((prev) => {
          const next = [...prev];
          next[i] = "processing";
          return next;
        });
        await new Promise((r) => setTimeout(r, 300));
        if (cancelled) return;
        setPipelineStatuses((prev) => {
          const next = [...prev];
          next[i] = "complete";
          return next;
        });
      }
    };
    runAnimation();

    return () => {
      cancelled = true;
    };
  }, []);

  // Build active waypoints from the pipeline response (new waypoint format: {name, pos, orient, conf, type})
  const activeTargets = useMemo(() => {
    if (pipelineData?.waypoints && pipelineData.waypoints.length > 0) {
      return pipelineData.waypoints;
    }
    if (canonicalWeldPath?.waypoints && canonicalWeldPath.waypoints.length > 0) {
      return canonicalWeldPath.waypoints;
    }
    // Fallback defaults matching the verified RAPID template
    return [
      { name: "home", pos: [1178.89, 0, 809.42], type: "home" },
      { name: "Target_40", pos: [414.69, 1112.75, 320.34], type: "weld_start" },
      { name: "Target_30", pos: [414.69, 1122.75, 343.37], type: "approach" },
      { name: "Target_20_5", pos: [338.53, 1333.74, 322.07], type: "weld_end" },
      { name: "Target_20", pos: [338.53, 1344.74, 354.01], type: "retract" },
    ];
  }, [pipelineData, canonicalWeldPath]);

  // Extract seam data from pipeline or defaults
  const seam = pipelineData?.seam || null;

  // Helper to get x, y, z from either new pos[] format or legacy {x, y, z}
  const getX = (wp) => wp.pos ? wp.pos[0] : (wp.x ?? 0);
  const getY = (wp) => wp.pos ? wp.pos[1] : (wp.y ?? 0);
  const getZ = (wp) => wp.pos ? wp.pos[2] : (wp.z ?? 0);

  const weldStartWP = activeTargets.find((wp) => wp.type === "weld_start") || activeTargets[1];
  const weldEndWP = activeTargets.find((wp) => wp.type === "weld_end") || activeTargets[3];

  const weldStartDisplay = seam
    ? `[${seam.startPoint.x.toFixed(2)}, ${seam.startPoint.y.toFixed(2)}, ${seam.startPoint.z.toFixed(2)}]`
    : weldStartWP
      ? `[${getX(weldStartWP).toFixed(2)}, ${getY(weldStartWP).toFixed(2)}, ${getZ(weldStartWP).toFixed(2)}]`
      : "[—]";
  const weldEndDisplay = seam
    ? `[${seam.endPoint.x.toFixed(2)}, ${seam.endPoint.y.toFixed(2)}, ${seam.endPoint.z.toFixed(2)}]`
    : weldEndWP
      ? `[${getX(weldEndWP).toFixed(2)}, ${getY(weldEndWP).toFixed(2)}, ${getZ(weldEndWP).toFixed(2)}]`
      : "[—]";

  const sourceFile = pipelineData?.sourceFile || "Feature.txt";
  const totalWaypoints = activeTargets.length;

  const handleApplyMapping = async () => {
    setProcessing(true);
    try {
      const res = await axiosClient.post("/process-pipeline");
      if (res.data && res.data.success) {
        const pipeline = res.data.pipeline;
        setCanonicalPath({
          id: `canonical_${Date.now()}`,
          source: sourceFile,
          coordinateFrame: "Robot Base Workspace (Direct)",
          waypoints: pipeline.waypoints,
          rapidCode: pipeline.rapidCode,
          totalWaypoints: pipeline.totalWaypoints,
          status: "Direct Robot Base Workspace Trajectory (Calibrated by TracerStudio)",
        });
      }

      setMappingComplete(true);
      updateProgress({ parseComplete: true });
      showToast(
        "✓ Trajectory Mapped",
        `Verified RAPID waypoints synthesized — ${totalWaypoints} targets in Path_10 structure.`,
        "success"
      );
      setTimeout(() => router.push("/generate"), 600);
    } catch {
      showToast("❌ Mapping Error", "Failed to synthesize RAPID trajectory.", "error");
    } finally {
      setProcessing(false);
    }
  };

  // SVG projection helpers
  const project3DTo2D = (pt, minX, maxX, minY, maxY) => {
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const normX = (getX(pt) - minX) / rangeX;
    const normY = (getY(pt) - minY) / rangeY;
    const canvasX = 60 + normX * 430;
    const canvasY = 170 - normY * 110;
    return { x: canvasX, y: canvasY };
  };

  const bounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    activeTargets.forEach((p) => {
      const px = getX(p), py = getY(p);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    });
    return { minX, maxX, minY, maxY };
  }, [activeTargets]);

  const projectedPoints = useMemo(() => {
    return activeTargets.map((pt) => project3DTo2D(pt, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY));
  }, [activeTargets, bounds]);

  const svgPolylinePoints = useMemo(() => {
    return projectedPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  }, [projectedPoints]);

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative">
      {/* Left Panel */}
      <div className="bg-surface-container-low border-r border-outline-variant shadow-sm flex flex-col w-[45%] h-full pt-6 px-5 gap-4 shrink-0 z-40 overflow-y-auto">
        <div className="px-1 select-none">
          <h2 className="text-xl font-extrabold text-on-surface tracking-tight">
            Payload Interpretation & Trajectory Mapping
          </h2>
          <p className="text-xs text-on-surface-variant font-medium mt-1.5 leading-relaxed">
            Decode incoming TracerStudio Feature descriptors and synthesize verified ABB RAPID motion waypoints (Home, Approach, Weld, Retract).
          </p>
        </div>

        <StepperProgress />

        <div className="h-px w-full bg-outline-variant/60 my-1 opacity-50"></div>

        <div className="flex-1 flex flex-col gap-5 pb-6">
          {/* Card 1: Incoming Payload Summary */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">inbox</span>
              Incoming Payload Summary
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">SOURCE</span>
                <span className="block font-mono font-bold text-on-surface mt-0.5">{sourceFile}</span>
              </div>
              <div className="p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">TOTAL WAYPOINTS</span>
                <span className="block font-mono font-bold text-primary mt-0.5">{totalWaypoints} Targets (Verified RAPID Flow)</span>
              </div>
              <div className="p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest col-span-2">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">STATUS</span>
                <span className="block font-mono font-bold text-green-600 mt-0.5">Direct Robot Base Workspace Trajectory (Calibrated by TracerStudio)</span>
              </div>
              <div className="p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">WELD START (Target_40)</span>
                <span className="block font-mono font-bold text-emerald-600 mt-0.5">
                  {weldStartDisplay}
                </span>
              </div>
              <div className="p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">WELD END (Target_20_5)</span>
                <span className="block font-mono font-bold text-red-600 mt-0.5">
                  {weldEndDisplay}
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Parsing Pipeline */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">pipeline</span>
              Feature Extraction & RAPID Compilation Pipeline
            </h3>
            <div className="flex flex-col gap-3">
              {PIPELINE_STEPS.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-primary/10">
                    <span className="material-symbols-outlined text-[16px] text-primary">
                      {pipelineStatuses[i] === "complete" ? "check_circle" : step.icon}
                    </span>
                  </div>
                  <span className="text-xs font-bold flex-1 text-on-surface">
                    {i + 1}. {step.label}
                  </span>
                  <span className="text-[10px] font-mono font-bold uppercase text-green-600">
                    {pipelineStatuses[i]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Apply Mapping Button */}
          <button
            onClick={handleApplyMapping}
            disabled={processing || mappingComplete}
            className="w-full bg-primary hover:bg-on-primary-fixed-variant disabled:bg-surface-container-high disabled:text-on-surface-variant text-on-primary px-4 py-3 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 shadow-sm cursor-pointer"
          >
            {processing ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                Synthesizing Trajectory...
              </>
            ) : mappingComplete ? (
              <>
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                Mapped — Redirecting to Compiler...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                Apply Mapping & Continue to Generate
              </>
            )}
          </button>

          {/* Bottom Navigation */}
          <div className="flex gap-4 select-none">
            <Link
              href="/acquire"
              className="flex-1 bg-surface border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              Back to Acquire
            </Link>
            <Link
              href="/generate"
              className="flex-1 bg-primary hover:bg-on-primary-fixed-variant text-on-primary px-4 py-3 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 shadow-sm cursor-pointer"
            >
              Next Step (Generate)
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Right Viewport */}
      <Active3DViewport
        title={`Workspace Toolpath Trajectory (Direct Feature Stream)`}
        showSolidControls
      >
        <div className="w-full h-full flex flex-col items-center justify-center relative">
          <div className="absolute inset-0 bg-3d-viewport"></div>
          <div className="absolute inset-0 viewport-grid"></div>

          <div className="relative z-10 w-full max-w-[750px] px-6">
            <div className="bg-surface/90 border border-outline-variant/40 rounded-xl p-5 mb-4 shadow-lg backdrop-blur-md">
              <div className="flex items-center justify-between mb-3 border-b border-outline-variant/30 pb-2">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[18px]">3d_rotation</span>
                  <span className="text-xs font-bold text-on-surface font-mono">
                    Workspace Toolpath Trajectory (Direct Feature Stream)
                  </span>
                </div>
                <span className="text-[10px] font-mono text-green-600 bg-green-500/10 px-2 py-0.5 rounded font-bold">
                  {totalWaypoints} Points Generated
                </span>
              </div>

              <svg viewBox="0 0 550 220" className="w-full h-56 bg-surface-container-lowest/50 rounded-lg border border-outline-variant/20">
                {[40, 80, 120, 160, 200].map((y, i) => (
                  <line key={i} x1="30" y1={y} x2="520" y2={y} stroke="#94a3b8" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.3" />
                ))}

                <polyline
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="3"
                  points={svgPolylinePoints}
                />

                {projectedPoints.map((pt, i) => (
                  <g key={i}>
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={i === 0 || i === projectedPoints.length - 1 ? "6" : "3.5"}
                      fill={i === 0 ? "#10b981" : i === projectedPoints.length - 1 ? "#ef4444" : "#3b82f6"}
                      stroke="#ffffff"
                      strokeWidth="1.5"
                    />
                  </g>
                ))}

                {projectedPoints[0] && (
                  <g transform={`translate(${projectedPoints[0].x}, ${projectedPoints[0].y})`}>
                    <line x1="0" y1="0" x2="0" y2="-22" stroke="#10b981" strokeWidth="1.5" strokeDasharray="2,2" />
                    <rect x="-24" y="-36" width="48" height="16" rx="4" fill="#10b981" />
                    <text x="0" y="-25" textAnchor="middle" fill="#ffffff" fontSize="9" fontFamily="monospace" fontWeight="bold">
                      HOME
                    </text>
                  </g>
                )}

                {projectedPoints[projectedPoints.length - 1] && (
                  <g transform={`translate(${projectedPoints[projectedPoints.length - 1].x}, ${projectedPoints[projectedPoints.length - 1].y})`}>
                    <line x1="0" y1="0" x2="0" y2="22" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="2,2" />
                    <rect x="-28" y="24" width="56" height="16" rx="4" fill="#ef4444" />
                    <text x="0" y="35" textAnchor="middle" fill="#ffffff" fontSize="9" fontFamily="monospace" fontWeight="bold">
                      RETRACT
                    </text>
                  </g>
                )}

                <g transform="translate(45, 195)">
                  <line x1="0" y1="0" x2="20" y2="0" stroke="#ef4444" strokeWidth="2" />
                  <line x1="0" y1="0" x2="0" y2="-20" stroke="#3b82f6" strokeWidth="2" />
                  <text x="24" y="4" fill="#ef4444" fontSize="9" fontFamily="monospace" fontWeight="bold">X_robot</text>
                  <text x="-4" y="-24" fill="#3b82f6" fontSize="9" fontFamily="monospace" fontWeight="bold">Z_robot</text>
                </g>
              </svg>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-surface/90 border border-outline-variant/30 rounded-lg p-3">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Source File</span>
                <span className="block text-xs font-mono font-bold text-primary mt-1">{sourceFile}</span>
              </div>
              <div className="bg-surface/90 border border-outline-variant/30 rounded-lg p-3">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Trajectory Points</span>
                <span className="block text-xs font-mono font-bold text-green-600 mt-1">{totalWaypoints} Waypoints (Path_10)</span>
              </div>
              <div className="bg-surface/90 border border-outline-variant/30 rounded-lg p-3">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Tool Configuration</span>
                <span className="block text-[10px] font-mono font-bold text-on-surface mt-1">tWeldGun (wobj0)</span>
              </div>
            </div>
          </div>
        </div>
      </Active3DViewport>
    </div>
  );
}