"use client";

import React, { useState } from "react";
import Link from "next/link";
import StepperProgress from "@/components/StepperProgress";
import Active3DViewport from "@/components/Active3DViewport";
import { useToast } from "@/components/ToastContext";

export default function ConfigurePage() {
  const { showToast } = useToast();

  // Parameter states
  const [weldType, setWeldType] = useState("Fillet Weld");
  const [segment, setSegment] = useState("Weld Segment 1");
  const [weldSpeed, setWeldSpeed] = useState("12");
  const [laserPower, setLaserPower] = useState("3200");
  const [gasFlow, setGasFlow] = useState("15");
  const [travelAngle, setTravelAngle] = useState("15");
  const [smoothingFilter, setSmoothingFilter] = useState("3");
  const [resolution, setResolution] = useState("0.5");

  const handleApplyConfig = (e) => {
    e.preventDefault();
    showToast(
      "✓ Parameters Applied",
      `Saved parameters for ${segment} (${weldType}): Power=${laserPower}W, Speed=${weldSpeed}mm/s.`
    );
  };

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative">
      {/* Left Sidebar Panel (45%) */}
      <aside className="bg-surface-container-low border-r border-outline-variant shadow-sm flex flex-col w-[45%] h-full pt-6 px-5 gap-4 shrink-0 z-40 overflow-y-auto">
        <div className="px-1 select-none">
          <h2 className="text-xl font-extrabold text-on-surface tracking-tight">
            Parameter Configuration Panel
          </h2>
          <p className="text-xs text-on-surface-variant font-medium mt-1.5 leading-relaxed">
            Define target welding and travel parameters for the scan segment to generate optimized trajectories.
          </p>
        </div>

        {/* Dynamic Workflow Progress Stepper */}
        <StepperProgress />

        <div className="h-px w-full bg-outline-variant/60 my-1 opacity-50"></div>

        {/* Configuration Form */}
        <form onSubmit={handleApplyConfig} className="flex-1 flex flex-col gap-5 pb-6">
          {/* Path Settings Card */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">weld</span>
              Process Segment Selection
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Weld Type
                </label>
                <select
                  value={weldType}
                  onChange={(e) => setWeldType(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs text-on-surface font-semibold focus:outline-none focus:border-primary appearance-none cursor-pointer"
                >
                  <option>Fillet Weld</option>
                  <option>Lap Joint</option>
                  <option>Butt Weld</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Segment ID
                </label>
                <select
                  value={segment}
                  onChange={(e) => setSegment(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs text-on-surface font-semibold focus:outline-none focus:border-primary appearance-none cursor-pointer"
                >
                  <option>Weld Segment 1</option>
                  <option>Weld Segment 2</option>
                  <option>Scan Track A</option>
                </select>
              </div>
            </div>
          </div>

          {/* Physical Parameters Card */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">tune</span>
              Weld Quality Parameters
            </h3>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Travel Speed (mm/s)
                </label>
                <input
                  type="number"
                  value={weldSpeed}
                  onChange={(e) => setWeldSpeed(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs font-mono text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Laser Power (W)
                </label>
                <input
                  type="number"
                  value={laserPower}
                  onChange={(e) => setLaserPower(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs font-mono text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Shield Gas (L/min)
                </label>
                <input
                  type="number"
                  value={gasFlow}
                  onChange={(e) => setGasFlow(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs font-mono text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Travel Angle (deg)
                </label>
                <input
                  type="number"
                  value={travelAngle}
                  onChange={(e) => setTravelAngle(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs font-mono text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
            </div>
          </div>

          {/* Path Smoothing Parameters */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">filter_list</span>
              Point Cloud Smoothing Filters
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Gaussian Filter Size
                </label>
                <input
                  type="number"
                  value={smoothingFilter}
                  onChange={(e) => setSmoothingFilter(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs font-mono text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Step Resolution (mm)
                </label>
                <input
                  type="number"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs font-mono text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
            </div>
          </div>

          {/* Action Trigger Buttons */}
          <div className="mt-auto flex flex-col gap-3">
            <button
              type="submit"
              className="w-full bg-primary hover:bg-surface-tint text-on-primary font-bold text-xs uppercase tracking-wider py-3.5 rounded-xl transition-colors cursor-pointer shadow-sm active:scale-[0.98] select-none text-center"
            >
              Apply Parameter Configurations
            </button>

            <div className="flex gap-4">
              <Link
                href="/calibrate"
                className="flex-1 bg-surface border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-xl py-3 font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm select-none"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                &lt; Back to Calibrate
              </Link>
              
              <Link
                href="/preview"
                className="flex-1 bg-primary text-on-primary hover:bg-surface-tint rounded-xl py-3 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all select-none cursor-pointer"
              >
                Next Step
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </Link>
            </div>
          </div>
        </form>
      </aside>

      {/* Right Viewport (55%) */}
      <div className="flex-1 h-full relative">
        <Active3DViewport title={`Configure Path Visualisation [${segment}]`}>
          {() => (
            <div className="relative w-full h-full flex justify-center items-center pointer-events-none">
              <svg className="w-[340px] h-[340px] text-primary/80" viewBox="0 0 100 100">
                {/* Visualizing weld seam segments */}
                <path d="M 10,80 Q 40,30 90,20" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M 10,80 Q 40,30 90,20" fill="none" stroke="#e0a025" strokeWidth="4" strokeDasharray="2 4" className="animate-pulse" />
                <circle cx="10" cy="80" r="3" fill="#ba1a1a" />
                <circle cx="90" cy="20" r="3" fill="#10b981" />
                <text x="12" y="85" fill="currentColor" className="text-[4px] font-mono font-bold select-none">START PT</text>
                <text x="75" y="16" fill="currentColor" className="text-[4px] font-mono font-bold select-none">END PT (WELD)</text>
              </svg>
              <div className="absolute bottom-16 bg-surface/90 backdrop-blur-sm border border-outline-variant px-4 py-2 rounded-lg text-center text-xs font-bold text-on-surface select-none shadow-sm pointer-events-auto">
                📐 Resolution: {resolution} mm | Weld Speed: {weldSpeed} mm/s.
              </div>
            </div>
          )}
        </Active3DViewport>
      </div>
    </div>
  );
}
