"use client";

import React, { useState } from "react";

export default function Active3DViewport({ 
  title = "[3D Point Cloud & ABB RobotStudio Simulation Window]",
  backgroundImage = "",
  children,
  showLiveBadge = false,
  showSolidControls = false,
  showSimControls = false,
}) {
  const [pointCloudActive, setPointCloudActive] = useState(true);
  const [viewMode, setViewMode] = useState("solid"); // "solid" | "wireframe"

  return (
    <main className="flex-1 relative flex flex-col min-w-0 bg-3d-viewport w-full h-full overflow-hidden">
      {/* Viewport Header */}
      <div className="absolute top-4 left-4 right-4 flex justify-between items-start z-10 pointer-events-none">
        <div className="bg-surface/90 backdrop-blur-md border border-outline-variant rounded-lg p-2 pointer-events-auto shadow-lg flex items-center gap-3">
          <span className="material-symbols-outlined text-primary">view_in_ar</span>
          <div className="flex flex-col">
            <span className="font-label-md text-[10px] text-on-surface-variant uppercase tracking-widest font-bold">Active Viewport</span>
            <span className="font-body-md text-[13px] text-on-surface font-semibold">{title}</span>
          </div>
        </div>

        {/* Live Preview Badge */}
        {showLiveBadge && (
          <div className="bg-surface/90 backdrop-blur-md border border-outline-variant rounded-lg px-3 py-1.5 flex items-center gap-2 shadow-sm pointer-events-auto">
            <span className="w-2.5 h-2.5 rounded-full bg-[#4ade80] glowing-badge animate-pulse"></span>
            <span className="font-label-md text-xs text-on-surface font-bold">Live Preview</span>
          </div>
        )}

        {/* Perspective Controls */}
        <div className="bg-surface/90 backdrop-blur-md border border-outline-variant rounded-lg p-1.5 pointer-events-auto flex flex-col sm:flex-row gap-1 shadow-lg">
          {showSolidControls ? (
            <>
              <button 
                onClick={() => setViewMode("wireframe")}
                className={`p-1.5 rounded hover:bg-surface-container-high transition-colors ${viewMode === "wireframe" ? "bg-surface-container-high text-primary" : "text-on-surface-variant"}`} 
                title="Wireframe"
              >
                <span className="material-symbols-outlined text-[18px]">polyline</span>
              </button>
              <button 
                onClick={() => setViewMode("solid")}
                className={`p-1.5 rounded hover:bg-surface-container-high transition-colors ${viewMode === "solid" ? "bg-surface-container-high text-primary" : "text-on-surface-variant"}`} 
                title="Solid"
              >
                <span className="material-symbols-outlined text-[18px]">view_in_ar</span>
              </button>
            </>
          ) : (
            <>
              <button className="p-1.5 rounded hover:bg-surface-container-high text-on-surface-variant hover:text-primary transition-colors" title="Top View">
                <span className="material-symbols-outlined text-[18px]">vertical_align_top</span>
              </button>
              <button className="p-1.5 rounded hover:bg-surface-container-high text-on-surface-variant hover:text-primary transition-colors" title="Front View">
                <span className="material-symbols-outlined text-[18px]">vertical_align_center</span>
              </button>
            </>
          )}
          <button className="p-1.5 rounded hover:bg-surface-container-high text-on-surface-variant hover:text-primary transition-colors" title="Reset/Isometric View">
            <span className="material-symbols-outlined text-[18px]">center_focus_strong</span>
          </button>
        </div>
      </div>

      {/* Main Viewport Workspace Area */}
      <div className="flex-1 w-full h-full relative flex items-center justify-center">
        {/* Background Image if supplied */}
        {backgroundImage && (
          <div 
            className="absolute inset-0 bg-cover bg-center w-full h-full opacity-90 mix-blend-multiply" 
            style={{ backgroundImage: `url('${backgroundImage}')` }}
          />
        )}

        {/* Viewport Tech Grid lines */}
        <div className="absolute inset-0 viewport-grid pointer-events-none"></div>

        {/* Children Rendered Inside */}
        <div className="relative z-10 w-full h-full flex items-center justify-center p-6">
          {children ? (
            typeof children === "function" ? children({ pointCloudActive, viewMode }) : children
          ) : (
            <div className="border-2 border-dashed border-outline-variant/40 rounded-xl p-12 text-center max-w-lg bg-surface/30 backdrop-blur-sm shadow-sm">
              <span className="material-symbols-outlined text-[48px] text-primary/40 mb-4 block">360</span>
              <h3 className="font-headline-sm text-lg text-on-surface font-semibold mb-2">Simulation Workspace</h3>
              <p className="font-body-md text-sm text-on-surface-variant">Generative RAPID code will render the path envelope here once generated.</p>
            </div>
          )}
        </div>
      </div>

            {/* Bottom Tool Navigation Controls */}
      {!showSimControls && false ? (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-surface/90 backdrop-blur-md border border-outline-variant rounded-full p-1.5 shadow-2xl z-10 pointer-events-auto">
          <button className="flex items-center gap-2 px-4 py-2 rounded-full hover:bg-surface-container-high text-on-surface-variant hover:text-primary font-bold text-xs transition-colors">
            <span className="material-symbols-outlined text-[18px]">360</span>
            <span>Orbit</span>
          </button>
          <div className="w-[1px] h-4 bg-outline-variant/60"></div>
          <button className="flex items-center gap-2 px-4 py-2 rounded-full hover:bg-surface-container-high text-on-surface-variant hover:text-primary font-bold text-xs transition-colors">
            <span className="material-symbols-outlined text-[18px]">pan_tool</span>
            <span>Pan</span>
          </button>
          <div className="w-[1px] h-4 bg-outline-variant/60"></div>
          <button className="flex items-center gap-2 px-4 py-2 rounded-full hover:bg-surface-container-high text-on-surface-variant hover:text-primary font-bold text-xs transition-colors">
            <span className="material-symbols-outlined text-[18px]">zoom_in</span>
            <span>Zoom</span>
          </button>
          <div className="w-[1px] h-4 bg-outline-variant/60"></div>
          <button 
            onClick={() => setPointCloudActive(!pointCloudActive)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold text-xs transition-all border ${
              pointCloudActive 
                ? "bg-primary-container text-on-primary-container border-primary/20" 
                : "bg-surface hover:bg-surface-container-high text-on-surface-variant border-outline-variant/50"
            }`}
          >
            <span className={`material-symbols-outlined text-[18px] ${pointCloudActive ? "text-on-primary-container" : ""}`}>
              scatter_plot
            </span>
            <span>{pointCloudActive ? "Hide Point Cloud" : "Show Point Cloud"}</span>
          </button>
        </div>
      ) : null}
    </main>
  );
}
