"use client";

import React, { useState } from "react";
import Link from "next/link";
import StepperProgress from "@/components/StepperProgress";
import Active3DViewport from "@/components/Active3DViewport";

export default function PreviewPage() {
  const [showLaser, setShowLaser] = useState(true);
  const [showVectors, setShowVectors] = useState(false);

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative">
      {/* Left Sidebar Panel (45%) */}
      <aside className="bg-surface-container-low border-r border-outline-variant shadow-sm flex flex-col w-[45%] h-full pt-6 px-5 gap-4 shrink-0 z-40 overflow-y-auto">
        <div className="px-1 select-none">
          <h2 className="text-xl font-extrabold text-on-surface tracking-tight">
            Trajectory &amp; IK Preview
          </h2>
          <p className="text-xs text-on-surface-variant font-medium mt-1.5 leading-relaxed">
            Verify the generated toolpath, check target reachability, and perform inverse kinematics (IK) simulations.
          </p>
        </div>

        {/* Dynamic Workflow Progress Stepper */}
        <StepperProgress />

        <div className="h-px w-full bg-outline-variant/60 my-1 opacity-50"></div>

        {/* Trajectory Readouts */}
        <div className="flex-1 flex flex-col gap-5 pb-6">
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden select-none">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">analytics</span>
              Path Trajectory Metrics
            </h3>
            
            <div className="grid grid-cols-2 gap-4 text-xs font-semibold">
              <div className="p-3 rounded-lg border border-surface-container bg-surface-container-lowest flex flex-col gap-1">
                <span className="text-on-surface-variant text-[10px] uppercase font-bold">Total Points</span>
                <span className="text-sm font-mono font-bold text-on-surface">142 Pts</span>
              </div>
              <div className="p-3 rounded-lg border border-surface-container bg-surface-container-lowest flex flex-col gap-1">
                <span className="text-on-surface-variant text-[10px] uppercase font-bold">Path Distance</span>
                <span className="text-sm font-mono font-bold text-on-surface">284.5 mm</span>
              </div>
              <div className="p-3 rounded-lg border border-surface-container bg-surface-container-lowest flex flex-col gap-1">
                <span className="text-on-surface-variant text-[10px] uppercase font-bold">IK Solver Check</span>
                <span className="text-sm font-mono font-bold text-[#10b981] flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm font-bold">check_circle</span> PASS
                </span>
              </div>
              <div className="p-3 rounded-lg border border-surface-container bg-surface-container-lowest flex flex-col gap-1">
                <span className="text-on-surface-variant text-[10px] uppercase font-bold">Singularity Check</span>
                <span className="text-sm font-mono font-bold text-[#10b981] flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm font-bold">check_circle</span> PASS
                </span>
              </div>
            </div>
          </div>

          {/* Visibility Options */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden select-none">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">visibility</span>
              Render Options
            </h3>
            
            <div className="flex flex-col gap-3">
              <label className="flex items-center justify-between cursor-pointer group">
                <span className="text-xs font-bold text-on-surface-variant group-hover:text-on-surface transition-colors">
                  Visualise Laser Profile Scan
                </span>
                <input
                  type="checkbox"
                  checked={showLaser}
                  onChange={(e) => setShowLaser(e.target.checked)}
                  className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary focus:ring-offset-background bg-surface cursor-pointer"
                />
              </label>
              <label className="flex items-center justify-between cursor-pointer group">
                <span className="text-xs font-bold text-on-surface-variant group-hover:text-on-surface transition-colors">
                  Visualise Tool Normal Orientation
                </span>
                <input
                  type="checkbox"
                  checked={showVectors}
                  onChange={(e) => setShowVectors(e.target.checked)}
                  className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary focus:ring-offset-background bg-surface cursor-pointer"
                />
              </label>
            </div>
          </div>

          {/* Action Trigger Buttons */}
          <div className="mt-auto flex gap-4">
            <Link
              href="/configure"
              className="flex-1 bg-surface border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm select-none"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              &lt; Back to Configure
            </Link>
            
            <Link
              href="/generate"
              className="flex-1 bg-primary text-on-primary hover:bg-surface-tint rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all select-none cursor-pointer"
            >
              Next Step
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </Link>
          </div>
        </div>
      </aside>

      {/* Right Viewport (55%) */}
      <div className="flex-1 h-full relative">
        <Active3DViewport 
          title="Live Trajectory Preview & Reachability Analysis"
          showLiveBadge={true}
          showSolidControls={true}
        >
          {({ pointCloudActive, viewMode }) => (
            <div className="relative w-full h-full flex justify-center items-center pointer-events-none">
              <svg className="w-[360px] h-[360px] text-primary" viewBox="0 0 100 100">
                {/* Visualizing 3D point cloud & normal vectors */}
                <path d="M 10,80 Q 40,30 90,20" fill="none" stroke="currentColor" strokeWidth={viewMode === "solid" ? "2" : "0.5"} />
                {showLaser && (
                  <path d="M 10,80 Q 40,30 90,20" fill="none" stroke="#ef4444" strokeWidth="5" strokeOpacity="0.4" strokeLinecap="round" className="animate-pulse" />
                )}
                {/* Vectors representation */}
                {showVectors && (
                  <>
                    <line x1="25" y1="65" x2="15" y2="45" stroke="#ef4444" strokeWidth="1" markerEnd="url(#arrow)" />
                    <line x1="50" y1="42" x2="45" y2="20" stroke="#ef4444" strokeWidth="1" />
                    <line x1="75" y1="24" x2="73" y2="2" stroke="#ef4444" strokeWidth="1" />
                  </>
                )}
                {pointCloudActive && (
                  <>
                    <circle cx="10" cy="80" r="1.5" fill="#3b82f6" />
                    <circle cx="20" cy="71" r="1.5" fill="#3b82f6" />
                    <circle cx="30" cy="62" r="1.5" fill="#3b82f6" />
                    <circle cx="40" cy="52" r="1.5" fill="#3b82f6" />
                    <circle cx="50" cy="42" r="1.5" fill="#3b82f6" />
                    <circle cx="60" cy="34" r="1.5" fill="#3b82f6" />
                    <circle cx="70" cy="27" r="1.5" fill="#3b82f6" />
                    <circle cx="80" cy="22" r="1.5" fill="#3b82f6" />
                    <circle cx="90" cy="20" r="1.5" fill="#3b82f6" />
                  </>
                )}
              </svg>
              <div className="absolute bottom-16 bg-surface/90 backdrop-blur-sm border border-outline-variant px-4 py-2 rounded-lg text-center text-xs font-bold text-on-surface select-none shadow-sm pointer-events-auto">
                🔍 {pointCloudActive ? "Scanning active:" : ""} 142 point normal vectors calculated.
              </div>
            </div>
          )}
        </Active3DViewport>
      </div>
    </div>
  );
}
