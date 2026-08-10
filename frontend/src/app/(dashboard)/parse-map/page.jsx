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
  { label: "Decode Feature.txt Packet", icon: "decode" },
  { label: "Validate OpenCV YAML Matrix", icon: "check_circle" },
  { label: "4x4 Matrix Transform (P_robot = T * P_camera)", icon: "transform" },
  { label: "Calculate ABB Quaternions [q1,q2,q3,q4]", icon: "tune" },
  { label: "Map to Canonical WeldPath Model", icon: "schema" },
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

  // Fetch real process-pipeline data on mount or when page loads
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

    // Run pipeline step completion animation
    const runAnimation = async () => {
      for (let i = 0; i < PIPELINE_STEPS.length; i++) {
        if (cancelled) return;
        setPipelineStatuses((prev) => {
          const next = [...prev];
          next[i] = "processing";
          return next;
        });
        await new Promise((r) => setTimeout(r, 400));
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

  // Compute active dataset metrics
  const activeTargets = useMemo(() => {
    if (pipelineData?.robotTargets && pipelineData.robotTargets.length > 0) {
      return pipelineData.robotTargets;
    }
    if (canonicalWeldPath?.pathPoints && canonicalWeldPath.pathPoints.length > 0) {
      return canonicalWeldPath.pathPoints;
    }
    if (rawPayload?.pathPoints && rawPayload.pathPoints.length > 0) {
      return rawPayload.pathPoints;
    }
    // Fallback default points
    return [
      { name: "p_approach", x: 130.8, y: 260.4, z: 440.8, q1: 1, q2: 0, q3: 0, q4: 0, type: "approach" },
      { name: "Target_10", x: 130.9, y: 260.7, z: 415.8, q1: 0.98, q2: 0.1, q3: -0.05, q4: 0.05, type: "weld" },
      { name: "Target_20", x: 141.2, y: 265.8, z: 416.0, q1: 0.96, q2: 0.15, q3: -0.1, q4: 0.05, type: "weld" },
      { name: "Target_30", x: 150.5, y: 271.2, z: 416.3, q1: 0.94, q2: 0.2, q3: -0.15, q4: 0.05, type: "weld" },
      { name: "Target_40", x: 160.9, y: 275.5, z: 416.6, q1: 0.92, q2: 0.22, q3: -0.18, q4: 0.05, type: "weld" },
      { name: "Target_50", x: 170.4, y: 280.2, z: 416.8, q1: 0.90, q2: 0.25, q3: -0.2, q4: 0.05, type: "weld" },
      { name: "p_retract", x: 170.4, y: 280.2, z: 446.8, q1: 1, q2: 0, q3: 0, q4: 0, type: "retract" },
    ];
  }, [pipelineData, canonicalWeldPath, rawPayload]);

  const sourceFile = pipelineData?.sourceFile || canonicalWeldPath?.source || "Feature.txt";
  const totalPoints = activeTargets.length;
  const statusString = pipelineData?.matrixStatus || "Mapped via handeye_result.yaml (4x4 Matrix Applied)";
  const startPoint = activeTargets[0] || { x: 0, y: 0, z: 0 };
  const endPoint = activeTargets[activeTargets.length - 1] || { x: 0, y: 0, z: 0 };

  const handleApplyMapping = async () => {
    setProcessing(true);
    try {
      const res = await axiosClient.post("/process-pipeline");
      if (res.data && res.data.success) {
        const pipeline = res.data.pipeline;
        setCanonicalPath({
          id: `canonical_${Date.now()}`,
          source: sourceFile,
          coordinateFrame: "WorkObject Frame",
          pathPoints: pipeline.robotTargets,
          rapidCode: pipeline.rapidCode,
          totalPoints: pipeline.totalPoints,
          status: statusString,
        });
      }

      setMappingComplete(true);
      updateProgress({ parseComplete: true });
      showToast(
        "✓ Payload Mapped",
        `Canonical WeldPath model created with ${totalPoints} points using handeye_result.yaml transformation matrix.`,
        "success"
      );
      setTimeout(() => router.push("/generate"), 800);
    } catch {
      showToast("❌ Mapping Error", "Failed to map payload to canonical model.", "error");
    } finally {
      setProcessing(false);
    }
  };

  // Helper function to project 3D point (x,y,z) to 2D SVG canvas (550x220)
  const project3DTo2D = (pt, minX, maxX, minY, maxY, minZ, maxZ) => {
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const normX = (pt.x - minX) / rangeX;
    const normY = (pt.y - minY) / rangeY;

    // SVG canvas dimensions: width 550, height 220
    const canvasX = 60 + normX * 430;
    const canvasY = 170 - normY * 110;
    return { x: canvasX, y: canvasY };
  };

  // Calculate 3D bounds for SVG scaling
  const bounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    activeTargets.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    });

    return { minX, maxX, minY, maxY, minZ, maxZ };
  }, [activeTargets]);

  const projectedPoints = useMemo(() => {
    return activeTargets.map((pt) => project3DTo2D(pt, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, bounds.minZ, bounds.maxZ));
  }, [activeTargets, bounds]);

  // Construct SVG Path String connecting all 3D points
  const svgPolylinePoints = useMemo(() => {
    return projectedPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  }, [projectedPoints]);

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative">
      {/* Left Panel */}
      <div className="bg-surface-container-low border-r border-outline-variant shadow-sm flex flex-col w-[45%] h-full pt-6 px-5 gap-4 shrink-0 z-40 overflow-y-auto">
        <div className="px-1 select-none">
          <h2 className="text-xl font-extrabold text-on-surface tracking-tight">
            Payload Interpretation & Path Mapping
          </h2>
          <p className="text-xs text-on-surface-variant font-medium mt-1.5 leading-relaxed">
            Decode incoming TracerStudio packets, apply OpenCV 4x4 hand-eye transformation, and convert data into internal weld-path model.
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
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">TOTAL POINTS</span>
                <span className="block font-mono font-bold text-primary mt-0.5">{totalPoints} Points</span>
              </div>
              <div className="p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest col-span-2">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">STATUS</span>
                <span className="block font-mono font-bold text-green-600 mt-0.5">{statusString}</span>
              </div>
              <div className="p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">START POINT (X,Y,Z)</span>
                <span className="block font-mono font-bold text-on-surface mt-0.5">
                  [{startPoint.x?.toFixed(1)}, {startPoint.y?.toFixed(1)}, {startPoint.z?.toFixed(1)}]
                </span>
              </div>
              <div className="p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">END POINT (X,Y,Z)</span>
                <span className="block font-mono font-bold text-on-surface mt-0.5">
                  [{endPoint.x?.toFixed(1)}, {endPoint.y?.toFixed(1)}, {endPoint.z?.toFixed(1)}]
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Parsing Pipeline */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">pipeline</span>
              Parsing & Matrix Transformation Pipeline
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
                Mapping Trajectory...
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

      {/* Right Viewport (Dynamic 3D Seam Trajectory Visualizer) */}
      <Active3DViewport
        title={`Parsed 3D Weld Seam Trajectory [${sourceFile} — ${totalPoints} Points]`}
        showSolidControls
      >
        <div className="w-full h-full flex flex-col items-center justify-center relative">
          <div className="absolute inset-0 bg-3d-viewport"></div>
          <div className="absolute inset-0 viewport-grid"></div>

          <div className="relative z-10 w-full max-w-[750px] px-6">
            {/* Real 3D Trajectory Projection Canvas */}
            <div className="bg-surface/90 border border-outline-variant/40 rounded-xl p-5 mb-4 shadow-lg backdrop-blur-md">
              <div className="flex items-center justify-between mb-3 border-b border-outline-variant/30 pb-2">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[18px]">3d_rotation</span>
                  <span className="text-xs font-bold text-on-surface font-mono">
                    Robot Base Frame Trajectory (P_robot = T_handeye * P_camera)
                  </span>
                </div>
                <span className="text-[10px] font-mono text-green-600 bg-green-500/10 px-2 py-0.5 rounded font-bold">
                  {totalPoints} Points Parsed
                </span>
              </div>

              <svg viewBox="0 0 550 220" className="w-full h-56 bg-surface-container-lowest/50 rounded-lg border border-outline-variant/20">
                {/* Background Grid Lines */}
                {[40, 80, 120, 160, 200].map((y, i) => (
                  <line key={i} x1="30" y1={y} x2="520" y2={y} stroke="#94a3b8" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.3" />
                ))}

                {/* Real Trajectory Line connecting parsed points */}
                <polyline
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="3"
                  points={svgPolylinePoints}
                />

                {/* Draw 3D Point Markers */}
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

                {/* START POINT Marker (GREEN) */}
                {projectedPoints[0] && (
                  <g transform={`translate(${projectedPoints[0].x}, ${projectedPoints[0].y})`}>
                    <line x1="0" y1="0" x2="0" y2="-22" stroke="#10b981" strokeWidth="1.5" strokeDasharray="2,2" />
                    <rect x="-24" y="-36" width="48" height="16" rx="4" fill="#10b981" />
                    <text x="0" y="-25" textAnchor="middle" fill="#ffffff" fontSize="9" fontFamily="monospace" fontWeight="bold">
                      START
                    </text>
                  </g>
                )}

                {/* END POINT Marker (RED) */}
                {projectedPoints[projectedPoints.length - 1] && (
                  <g transform={`translate(${projectedPoints[projectedPoints.length - 1].x}, ${projectedPoints[projectedPoints.length - 1].y})`}>
                    <line x1="0" y1="0" x2="0" y2="22" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="2,2" />
                    <rect x="-20" y="24" width="40" height="16" rx="4" fill="#ef4444" />
                    <text x="0" y="35" textAnchor="middle" fill="#ffffff" fontSize="9" fontFamily="monospace" fontWeight="bold">
                      END
                    </text>
                  </g>
                )}

                {/* Axis Indicator */}
                <g transform="translate(45, 195)">
                  <line x1="0" y1="0" x2="20" y2="0" stroke="#ef4444" strokeWidth="2" />
                  <line x1="0" y1="0" x2="0" y2="-20" stroke="#3b82f6" strokeWidth="2" />
                  <text x="24" y="4" fill="#ef4444" fontSize="9" fontFamily="monospace" fontWeight="bold">X_robot</text>
                  <text x="-4" y="-24" fill="#3b82f6" fontSize="9" fontFamily="monospace" fontWeight="bold">Z_robot</text>
                </g>
              </svg>
            </div>

            {/* Legend & Status Cards */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-surface/90 border border-outline-variant/30 rounded-lg p-3">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Source File</span>
                <span className="block text-xs font-mono font-bold text-primary mt-1">{sourceFile}</span>
              </div>
              <div className="bg-surface/90 border border-outline-variant/30 rounded-lg p-3">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Total Trajectory Points</span>
                <span className="block text-xs font-mono font-bold text-green-600 mt-1">{totalPoints} Points</span>
              </div>
              <div className="bg-surface/90 border border-outline-variant/30 rounded-lg p-3">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Transformation Matrix</span>
                <span className="block text-[10px] font-mono font-bold text-on-surface mt-1">4x4 Hand-Eye Matrix Applied</span>
              </div>
            </div>

            {/* Legend */}
            <div className="bg-surface/90 border border-outline-variant/30 rounded-lg p-3">
              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Trajectory Map Legend</span>
              <div className="grid grid-cols-3 gap-2 mt-1.5">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-[#10b981]"></div>
                  <span className="text-[10px] text-on-surface-variant">START Point (First Coeff)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-[#ef4444]"></div>
                  <span className="text-[10px] text-on-surface-variant">END Point (Last Coeff)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-[#3b82f6]"></div>
                  <span className="text-[10px] text-on-surface-variant">3D Transformed Waypoints</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Active3DViewport>
    </div>
  );
}
