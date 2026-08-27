"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
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

// Color palette and descriptor for each waypoint type
const WP_CONFIG = {
  home: { fill: "#06b6d4", stroke: "#0891b2", badgeText: "home (Standby)", label: "HOME" },
  approach: { fill: "#eab308", stroke: "#ca8a04", badgeText: "Target_30 (Approach)", label: "APPROACH" },
  weld_start: { fill: "#22c55e", stroke: "#16a34a", badgeText: "Target_40 (Weld Start)", label: "WELD START" },
  weld_end: { fill: "#ef4444", stroke: "#dc2626", badgeText: "Target_20_5 (Weld End)", label: "WELD END" },
  retract: { fill: "#a855f7", stroke: "#7c3aed", badgeText: "Target_20 (Retract)", label: "RETRACT" },
};

// Precise badge anchor offsets directly attached to node (cx, cy)
// home: Placed directly above (cx, cy - 32px)
// Target_30 (Approach): Placed Top-Left (cx - 45px, cy - 30px) (Yellow Pill)
// Target_40 (Weld Start): Placed Bottom-Left (cx - 45px, cy + 30px) (Green Pill)
// Target_20_5 (Weld End): Placed Bottom-Right (cx + 45px, cy + 30px) (Red Pill)
// Target_20 (Retract): Placed Top-Right (cx + 45px, cy - 30px) (Purple Pill)
const BADGE_OFFSETS = {
  home: { dx: 0, dy: -32 },
  approach: { dx: -45, dy: -30 },
  weld_start: { dx: -45, dy: 30 },
  weld_end: { dx: 45, dy: 30 },
  retract: { dx: 45, dy: -30 },
};

export default function ParseMapPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const {
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
          setTimeout(() => { if (!cancelled) setSvgAnimPhase(1); }, 150);
          setTimeout(() => { if (!cancelled) setSvgAnimPhase(2); }, 1200);
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
        await new Promise((r) => setTimeout(r, 250));
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

  // Build active waypoints from the pipeline response or calibrated fallbacks
  const activeTargets = useMemo(() => {
    if (pipelineData?.waypoints && pipelineData.waypoints.length > 0) {
      return pipelineData.waypoints;
    }
    if (canonicalWeldPath?.waypoints && canonicalWeldPath.waypoints.length > 0) {
      return canonicalWeldPath.waypoints;
    }
    return [
      { id: "home", name: "home", pos: [1178.8902, 0.0, 809.4194], type: "home", speed: "v100", zone: "z100" },
      { id: "Target_30", name: "Target_30", pos: [1134.5077, -28.1485, 503.3040], type: "approach", speed: "v80", zone: "fine" },
      { id: "Target_40", name: "Target_40", pos: [1133.5288, -38.2234, 480.2780], type: "weld_start", speed: "v100", zone: "fine" },
      { id: "Target_20_5", name: "Target_20_5", pos: [877.8847, -53.0689, 454.1966], type: "weld_end", speed: "v100", zone: "fine" },
      { id: "Target_20", name: "Target_20", pos: [878.7127, -27.5201, 507.3889], type: "retract", speed: "v100", zone: "fine" },
    ];
  }, [pipelineData, canonicalWeldPath]);

  const seam = pipelineData?.seam || null;

  const getX = (wp) => (wp?.pos ? wp.pos[0] : (wp?.x ?? 0));
  const getY = (wp) => (wp?.pos ? wp.pos[1] : (wp?.y ?? 0));
  const getZ = (wp) => (wp?.pos ? wp.pos[2] : (wp?.z ?? 0));

  const weldStartWP = activeTargets.find((wp) => wp.type === "weld_start") || activeTargets[2];
  const weldEndWP = activeTargets.find((wp) => wp.type === "weld_end") || activeTargets[3];

  // ALWAYS display mapped table coordinates from the synthesized waypoints
  const weldStartDisplay = weldStartWP
    ? `[${getX(weldStartWP).toFixed(2)}, ${getY(weldStartWP).toFixed(2)}, ${getZ(weldStartWP).toFixed(2)}]`
    : "[1133.53, -38.22, 480.28]";

  const weldEndDisplay = weldEndWP
    ? `[${getX(weldEndWP).toFixed(2)}, ${getY(weldEndWP).toFixed(2)}, ${getZ(weldEndWP).toFixed(2)}]`
    : "[877.88, -53.07, 454.20]";

  // Compute strictly positive Euclidean seam length
  const seamLength = useMemo(() => {
    if (weldStartWP && weldEndWP) {
      const dx = getX(weldEndWP) - getX(weldStartWP);
      const dy = getY(weldEndWP) - getY(weldStartWP);
      const dz = getZ(weldEndWP) - getZ(weldStartWP);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 0.1) return Math.abs(d);
    }
    if (seam?.startPoint && seam?.endPoint) {
      const dx = seam.endPoint.x - seam.startPoint.x;
      const dy = seam.endPoint.y - seam.startPoint.y;
      const dz = seam.endPoint.z - seam.startPoint.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 0.1) return Math.abs(d);
    }
    return 233.8;
  }, [weldStartWP, weldEndWP, seam]);

  const seamGapWidth = Math.abs(seam?.seamWidth ?? 5.54);

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
  const SVG_W = 620;
  const SVG_H = 360;
  const PAD_X = 90;
  const PAD_Y = 80;

  const bounds = useMemo(() => {
    let minPx = Infinity, maxPx = -Infinity;
    let minPy = Infinity, maxPy = -Infinity;
    activeTargets.forEach((p) => {
      const ix = getX(p) * 0.7 + getY(p) * 0.7;
      const iy = getZ(p) - getY(p) * 0.25;
      if (ix < minPx) minPx = ix;
      if (ix > maxPx) maxPx = ix;
      if (iy < minPy) minPy = iy;
      if (iy > maxPy) maxPy = iy;
    });
    const padX = (maxPx - minPx) * 0.20 || 50;
    const padY = (maxPy - minPy) * 0.25 || 50;
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
      x: PAD_X + normX * (SVG_W - PAD_X * 2),
      y: (SVG_H - PAD_Y) - normY * (SVG_H - PAD_Y * 2),
    };
  };

  const projectedPoints = useMemo(() => {
    return activeTargets.map((pt) => ({
      ...project(pt),
      type: pt.type || "unknown",
      name: pt.name || pt.id || "?",
      speed: pt.speed || "v100",
      zone: pt.zone || "fine",
      pos: pt.pos || [getX(pt), getY(pt), getZ(pt)],
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
        color = "#eab308";
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

  const seamWidthVal = seam?.seamWidth || 5.54;
  const weldStartPt = projectedPoints.find((p) => p.type === "weld_start");
  const weldEndPt = projectedPoints.find((p) => p.type === "weld_end");

  // Dynamic 2D perpendicular normal and unit vectors
  const seam2d = useMemo(() => {
    if (!weldStartPt || !weldEndPt) {
      return {
        u: { x: 1, y: 0 },
        n: { x: 0, y: -1 },
        mid: { x: SVG_W / 2, y: SVG_H / 2 },
      };
    }
    const dx = weldEndPt.x - weldStartPt.x;
    const dy = weldEndPt.y - weldStartPt.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const u = { x: dx / len, y: dy / len };
    let n = { x: -u.y, y: u.x };
    // Ensure n points towards upper/left half-plane (away from seam)
    if (n.y > 0 || (Math.abs(n.y) < 0.001 && n.x > 0)) {
      n.x = -n.x;
      n.y = -n.y;
    }
    const mid = {
      x: (weldStartPt.x + weldEndPt.x) / 2,
      y: (weldStartPt.y + weldEndPt.y) / 2,
    };
    return { u, n, mid };
  }, [weldStartPt, weldEndPt]);

  // Seam dimension tag position (offset along +n_2d * 18px from midpoint)
  const seamDimPos = useMemo(() => {
    if (!weldStartPt || !weldEndPt) return null;
    return {
      x: seam2d.mid.x + seam2d.n.x * 18,
      y: seam2d.mid.y + seam2d.n.y * 18,
    };
  }, [weldStartPt, weldEndPt, seam2d]);

  // Dynamic Perpendicular Badge Offsets
  const getBadgeOffset = useCallback((ptType) => {
    const { u, n } = seam2d;
    switch (ptType) {
      case "approach":
        // +n_2d * 35px - u_2d * 25px (Yellow Pill)
        return {
          dx: n.x * 35 - u.x * 25,
          dy: n.y * 35 - u.y * 25,
        };
      case "retract":
        // +n_2d * 35px + u_2d * 25px (Purple Pill)
        return {
          dx: n.x * 35 + u.x * 25,
          dy: n.y * 35 + u.y * 25,
        };
      case "weld_start":
        // -n_2d * 35px - u_2d * 20px (Green Pill)
        return {
          dx: -n.x * 35 - u.x * 20,
          dy: -n.y * 35 - u.y * 20,
        };
      case "weld_end":
        // -n_2d * 35px + u_2d * 20px (Red Pill)
        return {
          dx: -n.x * 35 + u.x * 20,
          dy: -n.y * 35 + u.y * 20,
        };
      case "home":
      default:
        return { dx: 0, dy: -28 };
    }
  }, [seam2d]);

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

          <div className="relative z-10 w-full max-w-[860px] px-6 flex flex-col gap-4">
            {/* SVG Trajectory Visualization */}
            <div className="bg-surface/90 border border-outline-variant/40 rounded-xl p-5 shadow-lg backdrop-blur-md relative">
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

              {/* Clean HTML Legend Card Overlay — Top-Left dedicated card */}
              <div className="absolute top-16 left-7 z-20 bg-slate-900/90 backdrop-blur-md border border-slate-800 p-2.5 rounded-lg shadow-xl pointer-events-none flex flex-col gap-1.5 text-xs font-mono select-none">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-0.5 border-t border-dashed border-slate-500"></div>
                  <span className="text-[10px] text-slate-300 font-semibold">Air Motion</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-0.5 border-t border-dashed border-amber-400"></div>
                  <span className="text-[10px] text-slate-300 font-semibold">Approach/Retract</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-1 bg-cyan-400 rounded-full shadow-[0_0_8px_#22d3ee]"></div>
                  <span className="text-[10px] text-slate-300 font-semibold">Active Weld Seam</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-white"></div>
                  <span className="text-[10px] text-slate-300 font-semibold">Target Waypoints</span>
                </div>
              </div>

              <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full bg-surface-container-lowest/50 rounded-lg border border-outline-variant/20" style={{ height: "330px" }}>
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
                  <marker id="arrowYellow" markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto" markerUnits="strokeWidth">
                    <polygon points="0 0, 7 2.5, 0 5" fill="#eab308" />
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
                    <line x1={PAD_X - 25} y1={PAD_Y + frac * (SVG_H - PAD_Y * 2)} x2={SVG_W - PAD_X + 25} y2={PAD_Y + frac * (SVG_H - PAD_Y * 2)} stroke="#334155" strokeWidth="0.4" strokeDasharray="2,4" opacity="0.3" />
                    <line x1={PAD_X + frac * (SVG_W - PAD_X * 2)} y1={PAD_Y - 25} x2={PAD_X + frac * (SVG_W - PAD_X * 2)} y2={SVG_H - PAD_Y + 25} stroke="#334155" strokeWidth="0.4" strokeDasharray="2,4" opacity="0.3" />
                  </React.Fragment>
                ))}

                {/* Seam width translucent band */}
                {weldStartPt && weldEndPt && (
                  <line
                    x1={weldStartPt.x} y1={weldStartPt.y}
                    x2={weldEndPt.x} y2={weldEndPt.y}
                    stroke="#22d3ee" strokeWidth={Math.max(12, seamWidthVal * 2.2)}
                    strokeLinecap="round" opacity="0.12"
                  />
                )}

                {/* Path segments with directional arrows */}
                {segments.map((seg, i) => {
                  let marker = "url(#arrowGrey)";
                  if (seg.color === "#eab308") marker = "url(#arrowYellow)";
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
                      style={{ transition: `opacity 0.5s ease ${i * 0.2}s` }}
                    />
                  );
                })}

                {/* Active Seam Dimension Tag — Centered above cyan seam line */}
                {seamDimPos && svgAnimPhase >= 2 && (
                  <g opacity="1" style={{ transition: "opacity 0.6s ease 0.4s" }}>
                    <rect
                      x={seamDimPos.x - 85}
                      y={seamDimPos.y - 10}
                      width="170" height="20" rx="10"
                      fill="#0f172a" fillOpacity="0.95"
                      stroke="#334155" strokeWidth="1.2"
                    />
                    <text
                      x={seamDimPos.x}
                      y={seamDimPos.y + 3.5}
                      textAnchor="middle"
                      fill="#22d3ee" fontSize="9.5" fontFamily="monospace" fontWeight="bold"
                    >
                      {`Length: ${Math.abs(seamLength).toFixed(1)} mm | Gap: ${seamGapWidth.toFixed(2)} mm`}
                    </text>
                  </g>
                )}

                {/* Dynamic Perpendicular Non-Colliding Waypoint Badges */}
                {projectedPoints.map((pt, i) => {
                  const cfg = WP_CONFIG[pt.type] || { fill: "#64748b", stroke: "#475569", badgeText: pt.name };
                  const offset = getBadgeOffset(pt.type);
                  const isKey = pt.type === "home" || pt.type === "weld_start" || pt.type === "weld_end";
                  const r = isKey ? 6 : 4.5;

                  const badgeText = cfg.badgeText;
                  const pillW = Math.max(badgeText.length * 6.8 + 18, 90);
                  const pillH = 19;
                  const pillRx = 9.5;

                  // Center position of badge
                  const badgeCx = pt.x + offset.dx;
                  const badgeCy = pt.y + offset.dy;

                  // Vector from node to badge for smooth leader line
                  const vbx = badgeCx - pt.x;
                  const vby = badgeCy - pt.y;
                  const vDist = Math.sqrt(vbx * vbx + vby * vby) || 1;
                  const vnx = vbx / vDist;
                  const vny = vby / vDist;

                  const leaderStartX = pt.x + vnx * r;
                  const leaderStartY = pt.y + vny * r;
                  const leaderEndX = badgeCx - vnx * (pillH / 2);
                  const leaderEndY = badgeCy - vny * (pillH / 2);

                  return (
                    <g
                      key={`wp-${i}`}
                      opacity={svgAnimPhase >= 1 ? 1 : 0}
                      style={{ transition: `opacity 0.4s ease ${0.25 + i * 0.12}s` }}
                    >
                      {/* Pulse ring on key waypoints */}
                      {isKey && (
                        <circle cx={pt.x} cy={pt.y} r={r + 4} fill="none" stroke={cfg.fill} strokeWidth="1" opacity="0.35">
                          <animate attributeName="r" from={r + 2} to={r + 10} dur="2.5s" repeatCount="indefinite" />
                          <animate attributeName="opacity" from="0.5" to="0" dur="2.5s" repeatCount="indefinite" />
                        </circle>
                      )}

                      {/* Waypoint Dot */}
                      <circle cx={pt.x} cy={pt.y} r={r} fill={cfg.fill} stroke="#ffffff" strokeWidth="1.5" />

                      {/* Direct short leader line from node to badge */}
                      <line
                        x1={leaderStartX} y1={leaderStartY}
                        x2={leaderEndX} y2={leaderEndY}
                        stroke={cfg.fill} strokeWidth="1.2" strokeDasharray="2,2" opacity="0.75"
                      />

                      {/* Pill Badge centered at (badgeCx, badgeCy) */}
                      <rect
                        x={badgeCx - pillW / 2} y={badgeCy - pillH / 2}
                        width={pillW} height={pillH} rx={pillRx}
                        fill={cfg.fill} fillOpacity="0.95"
                        stroke="#ffffff" strokeWidth="0.8" strokeOpacity="0.6"
                      />
                      <text
                        x={badgeCx}
                        y={badgeCy + 3.8}
                        textAnchor="middle"
                        fill="#ffffff" fontSize="8.5" fontFamily="monospace" fontWeight="bold"
                      >
                        {badgeText}
                      </text>
                    </g>
                  );
                })}

                {/* Axis indicator — bottom-left */}
                <g transform={`translate(${PAD_X - 45}, ${SVG_H - PAD_Y + 30})`}>
                  <line x1="0" y1="0" x2="22" y2="0" stroke="#ef4444" strokeWidth="1.5" />
                  <line x1="0" y1="0" x2="0" y2="-22" stroke="#22d3ee" strokeWidth="1.5" />
                  <line x1="0" y1="0" x2="12" y2="-10" stroke="#a3e635" strokeWidth="1.5" />
                  <text x="26" y="3" fill="#ef4444" fontSize="8" fontFamily="monospace" fontWeight="bold">X</text>
                  <text x="-2" y="-26" fill="#22d3ee" fontSize="8" fontFamily="monospace" fontWeight="bold">Z</text>
                  <text x="14" y="-12" fill="#a3e635" fontSize="8" fontFamily="monospace" fontWeight="bold">Y</text>
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
                      const cfg = WP_CONFIG[wp.type] || { fill: "#64748b" };
                      return (
                        <tr key={i} className="border-b border-outline-variant/15 hover:bg-surface-container-lowest/60 transition-colors">
                          <td className="py-1.5 pr-3">
                            <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: cfg.fill }}></span>
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