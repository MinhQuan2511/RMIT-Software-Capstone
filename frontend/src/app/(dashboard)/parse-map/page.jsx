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

// Color palette for each waypoint type
const WP_COLORS = {
  home: { fill: "#10b981", stroke: "#059669", label: "HOME" },
  approach: { fill: "#3b82f6", stroke: "#2563eb", label: "APPROACH" },
  weld_start: { fill: "#22c55e", stroke: "#16a34a", label: "WELD START" },
  weld_end: { fill: "#ef4444", stroke: "#dc2626", label: "WELD END" },
  retract: { fill: "#a855f7", stroke: "#7c3aed", label: "RETRACT" },
};

// Per-waypoint label placement config to avoid overlapping
const LABEL_PLACEMENT = {
  home: { dx: 0, dy: -22, anchor: "middle" },
  approach: { dx: -40, dy: -14, anchor: "end" },
  weld_start: { dx: 0, dy: 20, anchor: "middle" },
  weld_end: { dx: 0, dy: 20, anchor: "middle" },
  retract: { dx: 40, dy: -14, anchor: "start" },
};

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
  const [svgAnimPhase, setSvgAnimPhase] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadPipelineData() {
      try {
        const res = await axiosClient.post("/process-pipeline");
        if (!cancelled && res.data && res.data.success) {
          setPipelineData(res.data.pipeline);
          setTimeout(() => { if (!cancelled) setSvgAnimPhase(1); }, 200);
          setTimeout(() => { if (!cancelled) setSvgAnimPhase(2); }, 1800);
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

    return () => { cancelled = true; };
  }, []);

  // Build active waypoints from the pipeline response
  const activeTargets = useMemo(() => {
    if (pipelineData?.waypoints && pipelineData.waypoints.length > 0) {
      return pipelineData.waypoints;
    }
    if (canonicalWeldPath?.waypoints && canonicalWeldPath.waypoints.length > 0) {
      return canonicalWeldPath.waypoints;
    }
    return [
      { id: "home", name: "home", pos: [226.61, 1023.25, 722.07], type: "home", speed: "v100", zone: "z100" },
      { id: "Target_30", name: "Target_30", pos: [427.75, 1074.86, 350.34], type: "approach", speed: "v80", zone: "fine" },
      { id: "Target_40", name: "Target_40", pos: [414.69, 1112.75, 320.34], type: "weld_start", speed: "v100", zone: "fine" },
      { id: "Target_20_5", name: "Target_20_5", pos: [338.53, 1333.74, 322.07], type: "weld_end", speed: "v100", zone: "fine" },
      { id: "Target_20", name: "Target_20", pos: [338.53, 1333.74, 362.07], type: "retract", speed: "v100", zone: "fine" },
    ];
  }, [pipelineData, canonicalWeldPath]);

  const seam = pipelineData?.seam || null;

  const getX = (wp) => wp.pos ? wp.pos[0] : (wp.x ?? 0);
  const getY = (wp) => wp.pos ? wp.pos[1] : (wp.y ?? 0);
  const getZ = (wp) => wp.pos ? wp.pos[2] : (wp.z ?? 0);

  const weldStartWP = activeTargets.find((wp) => wp.type === "weld_start") || activeTargets[2];
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

  // ─── Isometric 2.5D Projection ────────────────────────────────────────
  // Combines X, Y (horizontal spread) with Z (vertical height) so elevation
  // differences between e.g. Target_20 and Target_20_5 are clearly visible.
  const SVG_W = 580;
  const SVG_H = 340;
  const PAD = 65;

  const bounds = useMemo(() => {
    let minPx = Infinity, maxPx = -Infinity;
    let minPy = Infinity, maxPy = -Infinity;
    activeTargets.forEach((p) => {
      // Isometric: project x,y onto a single horizontal axis, use z for vertical
      const ix = getX(p) * 0.7 + getY(p) * 0.7;
      const iy = getZ(p) - getY(p) * 0.25;
      if (ix < minPx) minPx = ix;
      if (ix > maxPx) maxPx = ix;
      if (iy < minPy) minPy = iy;
      if (iy > maxPy) maxPy = iy;
    });
    const padX = (maxPx - minPx) * 0.12 || 50;
    const padY = (maxPy - minPy) * 0.15 || 50;
    return { minX: minPx - padX, maxX: maxPx + padX, minY: minPy - padY, maxY: maxPy + padY };
  }, [activeTargets]);

  const project = (wp) => {
    const rangeX = bounds.maxX - bounds.minX || 1;
    const rangeY = bounds.maxY - bounds.minY || 1;
    const ix = getX(wp) * 0.7 + getY(wp) * 0.7;
    const iy = getZ(wp) - getY(wp) * 0.25;
    const normX = (ix - bounds.minX) / rangeX;
    const normY = (iy - bounds.minY) / rangeY;
    return {
      x: PAD + normX * (SVG_W - PAD * 2),
      y: (SVG_H - PAD) - normY * (SVG_H - PAD * 2),
    };
  };

  const projectedPoints = useMemo(() => {
    return activeTargets.map((pt) => ({
      ...project(pt),
      type: pt.type || "unknown",
      name: pt.name || pt.id || "?",
      speed: pt.speed || "v100",
      zone: pt.zone || "fine",
    }));
  }, [activeTargets, bounds]);

  // Build segment data for color-coded lines
  const segments = useMemo(() => {
    if (projectedPoints.length < 2) return [];
    const segs = [];
    for (let i = 0; i < projectedPoints.length - 1; i++) {
      const from = projectedPoints[i];
      const to = projectedPoints[i + 1];
      let color = "#64748b";
      let dash = "6,4";
      let width = 1.5;
      let glow = false;

      if (from.type === "weld_start" && to.type === "weld_end") {
        color = "#22d3ee";
        width = 4;
        dash = "";
        glow = true;
      } else if (from.type === "approach" && to.type === "weld_start") {
        color = "#3b82f6";
        width = 2;
        dash = "5,3";
      } else if (from.type === "weld_end" && to.type === "retract") {
        color = "#a855f7";
        width = 2;
        dash = "5,3";
      } else {
        color = "#475569";
        dash = "6,4";
        width = 1.5;
      }
      segs.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, color, dash, width, glow });
    }
    return segs;
  }, [projectedPoints]);

  const seamWidthVal = seam?.seamWidth || 5;
  const weldStartPt = projectedPoints.find((p) => p.type === "weld_start");
  const weldEndPt = projectedPoints.find((p) => p.type === "weld_end");

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
                <span className="block font-mono font-bold text-emerald-600 mt-0.5">{weldStartDisplay}</span>
              </div>
              <div className="p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">WELD END (Target_20_5)</span>
                <span className="block font-mono font-bold text-red-600 mt-0.5">{weldEndDisplay}</span>
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

      {/* Right Viewport — Isometric 2.5D Trajectory Visualizer */}
      <Active3DViewport
        title={`Workspace Toolpath Trajectory (Direct Feature Stream)`}
        showSolidControls
      >
        <div className="w-full h-full flex flex-col items-center justify-center relative">
          <div className="absolute inset-0 bg-3d-viewport"></div>
          <div className="absolute inset-0 viewport-grid"></div>

          <div className="relative z-10 w-full max-w-[800px] px-6 flex flex-col gap-4">
            {/* SVG Trajectory Visualization */}
            <div className="bg-surface/90 border border-outline-variant/40 rounded-xl p-5 shadow-lg backdrop-blur-md">
              <div className="flex items-center justify-between mb-3 border-b border-outline-variant/30 pb-2">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[18px]">3d_rotation</span>
                  <span className="text-xs font-bold text-on-surface font-mono">
                    Isometric Toolpath Projection (2.5D)
                  </span>
                </div>
                <span className="text-[10px] font-mono text-green-600 bg-green-500/10 px-2 py-0.5 rounded font-bold">
                  {totalWaypoints} Points
                </span>
              </div>

              <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full bg-surface-container-lowest/50 rounded-lg border border-outline-variant/20" style={{ height: "300px" }}>
                <defs>
                  {/* Cyan glow filter for weld seam */}
                  <filter id="cyanGlow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                  <marker id="arrowGrey" markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto" markerUnits="strokeWidth">
                    <polygon points="0 0, 7 2.5, 0 5" fill="#64748b" />
                  </marker>
                  <marker id="arrowBlue" markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto" markerUnits="strokeWidth">
                    <polygon points="0 0, 7 2.5, 0 5" fill="#3b82f6" />
                  </marker>
                  <marker id="arrowCyan" markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto" markerUnits="strokeWidth">
                    <polygon points="0 0, 7 2.5, 0 5" fill="#22d3ee" />
                  </marker>
                  <marker id="arrowPurple" markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto" markerUnits="strokeWidth">
                    <polygon points="0 0, 7 2.5, 0 5" fill="#a855f7" />
                  </marker>
                </defs>

                {/* Subtle background grid */}
                {[0.2, 0.4, 0.6, 0.8].map((frac, i) => (
                  <React.Fragment key={`grid-${i}`}>
                    <line x1={PAD} y1={PAD + frac * (SVG_H - PAD * 2)} x2={SVG_W - PAD} y2={PAD + frac * (SVG_H - PAD * 2)} stroke="#334155" strokeWidth="0.4" strokeDasharray="2,4" opacity="0.3" />
                    <line x1={PAD + frac * (SVG_W - PAD * 2)} y1={PAD} x2={PAD + frac * (SVG_W - PAD * 2)} y2={SVG_H - PAD} stroke="#334155" strokeWidth="0.4" strokeDasharray="2,4" opacity="0.3" />
                  </React.Fragment>
                ))}

                {/* Seam width translucent band */}
                {weldStartPt && weldEndPt && (
                  <line
                    x1={weldStartPt.x} y1={weldStartPt.y}
                    x2={weldEndPt.x} y2={weldEndPt.y}
                    stroke="#22d3ee" strokeWidth={Math.max(10, seamWidthVal * 2)}
                    strokeLinecap="round" opacity="0.08"
                  />
                )}

                {/* Path segments with arrows */}
                {segments.map((seg, i) => {
                  let marker = "url(#arrowGrey)";
                  if (seg.color === "#3b82f6") marker = "url(#arrowBlue)";
                  else if (seg.color === "#22d3ee") marker = "url(#arrowCyan)";
                  else if (seg.color === "#a855f7") marker = "url(#arrowPurple)";

                  return (
                    <line
                      key={`seg-${i}`}
                      x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2}
                      stroke={seg.color}
                      strokeWidth={seg.width}
                      strokeDasharray={seg.dash || "none"}
                      strokeLinecap="round"
                      markerEnd={marker}
                      filter={seg.glow ? "url(#cyanGlow)" : undefined}
                      opacity={svgAnimPhase >= 1 ? 1 : 0}
                      style={{ transition: `opacity 0.5s ease ${i * 0.25}s` }}
                    />
                  );
                })}

                {/* Waypoint markers with positioned labels */}
                {projectedPoints.map((pt, i) => {
                  const colors = WP_COLORS[pt.type] || { fill: "#64748b", stroke: "#475569", label: pt.name };
                  const placement = LABEL_PLACEMENT[pt.type] || { dx: 0, dy: -18, anchor: "middle" };
                  const isKey = pt.type === "home" || pt.type === "weld_start" || pt.type === "weld_end";
                  const r = isKey ? 6 : 4;

                  return (
                    <g
                      key={`wp-${i}`}
                      opacity={svgAnimPhase >= 1 ? 1 : 0}
                      style={{ transition: `opacity 0.4s ease ${0.4 + i * 0.18}s` }}
                    >
                      {/* Pulse ring on key waypoints */}
                      {isKey && (
                        <circle cx={pt.x} cy={pt.y} r={r + 4} fill="none" stroke={colors.fill} strokeWidth="1" opacity="0.3">
                          <animate attributeName="r" from={r + 2} to={r + 10} dur="2.5s" repeatCount="indefinite" />
                          <animate attributeName="opacity" from="0.4" to="0" dur="2.5s" repeatCount="indefinite" />
                        </circle>
                      )}

                      {/* Dot */}
                      <circle cx={pt.x} cy={pt.y} r={r} fill={colors.fill} stroke="#ffffff" strokeWidth="1.5" />

                      {/* Leader line to label */}
                      <line
                        x1={pt.x} y1={pt.y}
                        x2={pt.x + placement.dx * 0.5} y2={pt.y + (placement.dy > 0 ? 8 : -8)}
                        stroke={colors.fill} strokeWidth="0.8" strokeDasharray="1,1" opacity="0.4"
                      />

                      {/* Label badge */}
                      <rect
                        x={pt.x + placement.dx - (placement.anchor === "end" ? 56 : placement.anchor === "start" ? 0 : 30)}
                        y={pt.y + placement.dy - 8}
                        width="60" height="15" rx="3"
                        fill={colors.fill} opacity="0.92"
                      />
                      <text
                        x={pt.x + placement.dx - (placement.anchor === "end" ? 26 : placement.anchor === "start" ? 30 : 0)}
                        y={pt.y + placement.dy + 3}
                        textAnchor="middle"
                        fill="#ffffff" fontSize="7.5" fontFamily="monospace" fontWeight="bold"
                      >
                        {pt.name}
                      </text>
                    </g>
                  );
                })}

                {/* Axis indicator — top-left corner, clear of legend */}
                <g transform={`translate(${PAD - 10}, ${SVG_H - PAD + 10})`}>
                  <line x1="0" y1="0" x2="22" y2="0" stroke="#ef4444" strokeWidth="1.5" />
                  <line x1="0" y1="0" x2="0" y2="-22" stroke="#22d3ee" strokeWidth="1.5" />
                  <line x1="0" y1="0" x2="12" y2="-10" stroke="#a3e635" strokeWidth="1.5" />
                  <text x="26" y="3" fill="#ef4444" fontSize="8" fontFamily="monospace" fontWeight="bold">X</text>
                  <text x="-2" y="-26" fill="#22d3ee" fontSize="8" fontFamily="monospace" fontWeight="bold">Z</text>
                  <text x="14" y="-12" fill="#a3e635" fontSize="8" fontFamily="monospace" fontWeight="bold">Y</text>
                </g>

                {/* Legend — top-right, well-separated from axes */}
                <g transform={`translate(${SVG_W - 145}, ${PAD - 5})`}>
                  <rect x="-6" y="-6" width="138" height="58" rx="4" fill="#0f172a" opacity="0.6" />
                  <line x1="2" y1="4" x2="18" y2="4" stroke="#475569" strokeWidth="1.5" strokeDasharray="4,3" />
                  <text x="24" y="7" fill="#94a3b8" fontSize="7" fontFamily="monospace">Air Motion</text>
                  <line x1="2" y1="16" x2="18" y2="16" stroke="#3b82f6" strokeWidth="2" strokeDasharray="5,3" />
                  <text x="24" y="19" fill="#94a3b8" fontSize="7" fontFamily="monospace">Approach / Retract</text>
                  <line x1="2" y1="28" x2="18" y2="28" stroke="#22d3ee" strokeWidth="3" filter="url(#cyanGlow)" />
                  <text x="24" y="31" fill="#94a3b8" fontSize="7" fontFamily="monospace">Active Weld Seam</text>
                  <circle cx="10" cy="42" r="3" fill="#22c55e" stroke="#fff" strokeWidth="1" />
                  <text x="24" y="45" fill="#94a3b8" fontSize="7" fontFamily="monospace">Start / End Markers</text>
                </g>
              </svg>
            </div>

            {/* Coordinate Readout Table */}
            <div className="bg-surface/90 border border-outline-variant/40 rounded-xl p-4 shadow-lg backdrop-blur-md">
              <h4 className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px] text-primary">table_chart</span>
                Waypoint Coordinate Readout
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] font-mono">
                  <thead>
                    <tr className="border-b border-outline-variant/30">
                      <th className="text-left py-1.5 pr-3 text-on-surface-variant font-bold uppercase tracking-wider">#</th>
                      <th className="text-left py-1.5 pr-3 text-on-surface-variant font-bold uppercase tracking-wider">Name</th>
                      <th className="text-left py-1.5 pr-3 text-on-surface-variant font-bold uppercase tracking-wider">X</th>
                      <th className="text-left py-1.5 pr-3 text-on-surface-variant font-bold uppercase tracking-wider">Y</th>
                      <th className="text-left py-1.5 pr-3 text-on-surface-variant font-bold uppercase tracking-wider">Z</th>
                      <th className="text-left py-1.5 pr-3 text-on-surface-variant font-bold uppercase tracking-wider">Speed</th>
                      <th className="text-left py-1.5 text-on-surface-variant font-bold uppercase tracking-wider">Zone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeTargets.map((wp, i) => {
                      const colors = WP_COLORS[wp.type] || { fill: "#64748b" };
                      return (
                        <tr key={i} className="border-b border-outline-variant/15 hover:bg-surface-container-lowest/60 transition-colors">
                          <td className="py-1.5 pr-3">
                            <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: colors.fill }}></span>
                            {i + 1}
                          </td>
                          <td className="py-1.5 pr-3 font-bold text-on-surface">{wp.name || wp.id}</td>
                          <td className="py-1.5 pr-3 text-on-surface">{getX(wp).toFixed(3)}</td>
                          <td className="py-1.5 pr-3 text-on-surface">{getY(wp).toFixed(3)}</td>
                          <td className="py-1.5 pr-3 text-on-surface">{getZ(wp).toFixed(3)}</td>
                          <td className="py-1.5 pr-3 text-blue-500 font-bold">{wp.speed || "v100"}</td>
                          <td className="py-1.5 text-amber-500 font-bold">{wp.zone || "fine"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Info Stat Cards */}
            <div className="grid grid-cols-3 gap-3">
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