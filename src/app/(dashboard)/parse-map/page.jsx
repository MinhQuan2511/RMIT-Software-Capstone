"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StepperProgress from "@/components/StepperProgress";
import Active3DViewport from "@/components/Active3DViewport";
import { useToast } from "@/components/ToastContext";
import { useTcpWorkflow } from "@/components/TcpWorkflowContext";
import { parsePayload, mapToCanonicalWeldPath } from "@/services/tracerStudioTcpBridge";

const PIPELINE_STEPS = [
  { label: "Decode Packet", icon: "decode" },
  { label: "Validate Schema", icon: "check_circle" },
  { label: "Transform Coordinates", icon: "transform" },
  { label: "Smooth Path", icon: "tune" },
  { label: "Map to Canonical WeldPath", icon: "schema" },
];

const PIPELINE_STATUSES = ["waiting", "processing", "complete", "failed"];

function getStatusColor(status) {
  switch (status) {
    case "waiting": return "text-on-surface-variant/50";
    case "processing": return "text-primary";
    case "complete": return "text-[#10b981]";
    case "failed": return "text-error";
    default: return "text-on-surface-variant/50";
  }
}

function getStatusBg(status) {
  switch (status) {
    case "waiting": return "bg-surface-container";
    case "processing": return "bg-primary/10";
    case "complete": return "bg-[#10b981]/10";
    case "failed": return "bg-error/10";
    default: return "bg-surface-container";
  }
}

export default function ParseMapPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const {
    rawPayload,
    setRawPayloadData,
    canonicalWeldPath,
    setCanonicalPath,
    updateProgress,
  } = useTcpWorkflow();

  const [pipelineStatuses, setPipelineStatuses] = useState(
    PIPELINE_STEPS.map(() => "waiting")
  );
  const [processing, setProcessing] = useState(false);
  const [mappingComplete, setMappingComplete] = useState(false);

  // Use mock payload data if rawPayload is not set
  const mockPayload = rawPayload || {
    source: "tcp",
    responseCode: "002",
    requestType: "011",
    weldType: "Fillet Weld",
    pathCount: 1,
    totalPoints: 142,
    plateThicknessMm: 3.0,
    weldGapMm: 0.8,
    pathPoints: [],
  };

  // Run mock pipeline animation on mount
  useEffect(() => {
    let cancelled = false;
    const runPipeline = async () => {
      for (let i = 0; i < PIPELINE_STEPS.length; i++) {
        if (cancelled) return;
        setPipelineStatuses((prev) => {
          const next = [...prev];
          next[i] = "processing";
          return next;
        });
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 400));
        if (cancelled) return;
        setPipelineStatuses((prev) => {
          const next = [...prev];
          next[i] = "complete";
          return next;
        });
      }
    };
    runPipeline();
    return () => { cancelled = true; };
  }, []);

  const handleApplyMapping = async () => {
    setProcessing(true);
    try {
      const decoded = await parsePayload(mockPayload);
      if (!decoded.success) throw new Error("Decode failed");

      const mapped = await mapToCanonicalWeldPath(decoded.decoded);
      if (!mapped.success) throw new Error("Mapping failed");

      setCanonicalPath(mapped.canonical);
      setMappingComplete(true);
      updateProgress({ parseComplete: true });
      showToast(
        "✓ Payload Mapped",
        "Canonical WeldPath model created successfully. Ready for RAPID generation.",
        "success"
      );
      setTimeout(() => router.push("/generate"), 800);
    } catch {
      showToast("❌ Mapping Error", "Failed to map payload to canonical model.", "error");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative">
      {/* Left Panel */}
      <div className="bg-surface-container-low border-r border-outline-variant shadow-sm flex flex-col w-[45%] h-full pt-6 px-5 gap-4 shrink-0 z-40 overflow-y-auto">
        <div className="px-1 select-none">
          <h2 className="text-xl font-extrabold text-on-surface tracking-tight">
            Payload Interpretation & Path Mapping
          </h2>
          <p className="text-xs text-on-surface-variant font-medium mt-1.5 leading-relaxed">
            Decode incoming TracerStudio packets, validate the payload, and convert data into the internal weld-path model.
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
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Source</span>
                <span className="block font-mono font-bold text-on-surface mt-0.5">{mockPayload.source} Response {mockPayload.responseCode}</span>
              </div>
              <div className="p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Weld Type</span>
                <span className="block font-mono font-bold text-on-surface mt-0.5">{mockPayload.weldType}</span>
              </div>
              <div className="p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Path Count</span>
                <span className="block font-mono font-bold text-on-surface mt-0.5">{mockPayload.pathCount}</span>
              </div>
              <div className="p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Total Points</span>
                <span className="block font-mono font-bold text-on-surface mt-0.5">{mockPayload.totalPoints}</span>
              </div>
              <div className="p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Plate Thickness</span>
                <span className="block font-mono font-bold text-on-surface mt-0.5">{mockPayload.plateThicknessMm} mm</span>
              </div>
              <div className="p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Weld Gap</span>
                <span className="block font-mono font-bold text-on-surface mt-0.5">{mockPayload.weldGapMm} mm</span>
              </div>
            </div>
          </div>

          {/* Card 2: Parsing Pipeline */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">pipeline</span>
              Parsing Pipeline
            </h3>
            <div className="flex flex-col gap-3">
              {PIPELINE_STEPS.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${getStatusBg(pipelineStatuses[i])}`}>
                    <span className={`material-symbols-outlined text-[16px] ${getStatusColor(pipelineStatuses[i])}`}>
                      {pipelineStatuses[i] === "complete" ? "check_circle" : pipelineStatuses[i] === "processing" ? "progress_activity" : step.icon}
                    </span>
                  </div>
                  <span className={`text-xs font-bold flex-1 ${getStatusColor(pipelineStatuses[i])}`}>
                    {i + 1}. {step.label}
                  </span>
                  <span className={`text-[10px] font-mono font-bold uppercase ${getStatusColor(pipelineStatuses[i])}`}>
                    {pipelineStatuses[i]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Card 3: Field Mapping Rules */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">rule</span>
              Field Mapping Rules
            </h3>
            <div className="flex flex-col gap-2.5">
              {[
                { from: "Pose Frame", to: "WorkObject Frame" },
                { from: "Orientation", to: "Tool Quaternion" },
                { from: "Start/End Points", to: "Approach/Retract" },
                { from: "Meta Tags", to: "Job Parameters" },
              ].map((rule, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-lg border border-surface-container bg-surface-container-lowest">
                  <span className="text-[11px] font-mono font-bold text-primary">{rule.from}</span>
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">arrow_forward</span>
                  <span className="text-[11px] font-mono font-bold text-on-surface">{rule.to}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Card 4: Validation & Error Handling */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">verified</span>
              Validation & Error Handling
            </h3>
            <div className="flex flex-col gap-2">
              {[
                { status: "complete", text: "No missing fields" },
                { status: "complete", text: "Orientation normalized" },
                { status: "complete", text: "Coordinate data valid" },
                { status: "complete", text: "Ready for RAPID generation" },
              ].map((check, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className={`material-symbols-outlined text-[16px] ${getStatusColor(check.status)}`}>
                    {check.status === "complete" ? "check_circle" : "cancel"}
                  </span>
                  <span className={`text-xs font-bold ${getStatusColor(check.status)}`}>{check.text}</span>
                </div>
              ))}
            </div>
            {/* Potential error states for future testing */}
            <div className="mt-3 pt-3 border-t border-outline-variant/30">
              <span className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider">Potential Error States (Future Testing)</span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {["Missing point data", "Invalid response code", "Unsupported coordinate frame", "Invalid numeric value", "Empty trajectory"].map((err) => (
                  <span key={err} className="text-[10px] font-mono text-on-surface-variant/40 bg-surface-container px-2 py-0.5 rounded">
                    {err}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Apply Mapping Button */}
          <button
            onClick={handleApplyMapping}
            disabled={processing || mappingComplete}
            className="w-full bg-primary hover:bg-on-primary-fixed-variant disabled:bg-surface-container-high disabled:text-on-surface-variant text-on-primary px-4 py-3 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 shadow-sm"
          >
            {processing ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                Mapping...
              </>
            ) : mappingComplete ? (
              <>
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                Mapped — Redirecting...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                Apply Mapping & Continue
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
              className="flex-1 bg-primary hover:bg-on-primary-fixed-variant text-on-primary px-4 py-3 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 shadow-sm opacity-50 cursor-not-allowed"
            >
              Next Step
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Right Viewport */}
      <Active3DViewport
        title="Payload Interpreter"
        showSolidControls
      >
        <div className="w-full h-full flex flex-col items-center justify-center relative">
          <div className="absolute inset-0 bg-3d-viewport"></div>
          <div className="absolute inset-0 viewport-grid"></div>

          <div className="relative z-10 w-full max-w-[700px] px-8">
            {/* Weld Path Visualization */}
            <div className="bg-surface/80 border border-outline-variant/30 rounded-xl p-4 mb-4">
              <svg viewBox="0 0 600 200" className="w-full h-48">
                {/* Smoothed path (orange dashed) */}
                <path
                  d="M 50 150 Q 150 120, 250 100 T 400 80 T 550 60"
                  fill="none"
                  stroke="#f97316"
                  strokeWidth="1.5"
                  strokeDasharray="6,4"
                  opacity="0.6"
                />
                {/* Canonical weld path (blue solid) */}
                <path
                  d="M 50 150 Q 140 130, 230 110 T 380 90 T 550 60"
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="2.5"
                />
                {/* Path point markers */}
                {[80, 110, 140, 170, 200, 230, 260, 290, 320, 350, 380, 410, 440, 470, 500, 530].map((x, i) => {
                  const y = 150 - (i * 6.5) + Math.sin(i * 0.3) * 8;
                  return (
                    <circle key={i} cx={x} cy={y} r="2.5" fill="#3b82f6" opacity="0.7" />
                  );
                })}
                {/* Start point (red) */}
                <circle cx="50" cy="150" r="5" fill="#ef4444" />
                <text x="50" y="170" textAnchor="middle" fill="#ef4444" fontSize="9" fontFamily="monospace" fontWeight="bold">START</text>
                {/* End point (green) */}
                <circle cx="550" cy="60" r="5" fill="#10b981" />
                <text x="550" y="50" textAnchor="middle" fill="#10b981" fontSize="9" fontFamily="monospace" fontWeight="bold">END</text>
                {/* Orientation vectors (green lines) */}
                {[140, 260, 380, 500].map((x, i) => {
                  const y = 150 - (i * 13) + Math.sin(i * 0.3) * 8;
                  return (
                    <line key={i} x1={x} y1={y} x2={x + 15} y2={y - 20} stroke="#10b981" strokeWidth="1" opacity="0.5" />
                  );
                })}
                {/* Axis indicator */}
                <g transform="translate(30, 170)">
                  <line x1="0" y1="0" x2="15" y2="0" stroke="#ef4444" strokeWidth="1.5" />
                  <line x1="0" y1="0" x2="0" y2="-15" stroke="#3b82f6" strokeWidth="1.5" />
                  <text x="18" y="3" fill="#ef4444" fontSize="8" fontFamily="monospace">X</text>
                  <text x="-3" y="-17" fill="#3b82f6" fontSize="8" fontFamily="monospace">Z</text>
                </g>
              </svg>
            </div>

            {/* Floating Cards */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-surface/80 border border-outline-variant/30 rounded-lg p-3">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Canonical WeldPath Model</span>
                <div className="mt-1.5 space-y-0.5">
                  <div className="flex justify-between">
                    <span className="text-[10px] text-on-surface-variant">Points</span>
                    <span className="text-[10px] font-mono font-bold text-on-surface">{mockPayload.totalPoints}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[10px] text-on-surface-variant">Model</span>
                    <span className="text-[10px] font-mono font-bold text-on-surface">WeldPath v1.0</span>
                  </div>
                </div>
              </div>
              <div className="bg-surface/80 border border-outline-variant/30 rounded-lg p-3">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Schema Valid</span>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="material-symbols-outlined text-[16px] text-[#10b981]">check_circle</span>
                  <span className="text-[10px] font-bold text-[#10b981]">All fields validated</span>
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="bg-surface/80 border border-outline-variant/30 rounded-lg p-3 mb-4">
              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Legend</span>
              <div className="grid grid-cols-3 gap-2 mt-1.5">
                {[
                  { color: "#3b82f6", label: "Weld Path" },
                  { color: "#f97316", label: "Smoothed Path" },
                  { color: "#3b82f6", label: "Path Points" },
                  { color: "#ef4444", label: "Start Point" },
                  { color: "#10b981", label: "End Point" },
                  { color: "#10b981", label: "Orientation Vectors" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                    <span className="text-[10px] text-on-surface-variant">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom Flow Panel */}
            <div className="bg-surface/80 border border-outline-variant/30 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-col items-center flex-1">
                  <span className="text-[10px] font-bold text-primary">Response 002</span>
                  <span className="text-[9px] font-mono text-on-surface-variant">Raw TCP Packet</span>
                  <span className="text-[9px] font-mono text-on-surface-variant">{mockPayload.totalPoints} Points</span>
                </div>
                <span className="material-symbols-outlined text-on-surface-variant/40 mx-3">arrow_forward</span>
                <div className="flex flex-col items-center flex-1">
                  <span className="text-[10px] font-bold text-teal-400">Decoded Path</span>
                  <span className="text-[9px] font-mono text-on-surface-variant">Validated Payload</span>
                  <span className="text-[9px] font-mono text-[#10b981]">Schema OK</span>
                </div>
                <span className="material-symbols-outlined text-on-surface-variant/40 mx-3">arrow_forward</span>
                <div className="flex flex-col items-center flex-1">
                  <span className="text-[10px] font-bold text-purple-400">Mapped Trajectory</span>
                  <span className="text-[9px] font-mono text-on-surface-variant">Canonical WeldPath</span>
                  <span className="text-[9px] font-mono text-[#10b981]">Ready for Generate</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Active3DViewport>
    </div>
  );
}
