"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "./AuthContext";
import { useIntegrationMode } from "./IntegrationModeContext";
import { useTcpWorkflow } from "./TcpWorkflowContext";
import IntegrationModeSwitch from "./IntegrationModeSwitch";

export default function Navbar() {
  const { user, logout, isAuthenticated } = useAuth();
  const { mode, tracerStatus } = useIntegrationMode();
  const { connectionStatus } = useTcpWorkflow();

  if (!isAuthenticated) return null;

  // Determine TracerStudio badge display
  let tracerBadge;
  if (mode === "api") {
    tracerBadge = {
      label: "TracerStudio API",
      status: "Connected",
      color: "green",
    };
  } else {
    // TCP mode
    if (connectionStatus === "connected") {
      tracerBadge = {
        label: "TracerStudio Bridge",
        status: "Online",
        color: "green",
      };
    } else {
      tracerBadge = {
        label: "TracerStudio Bridge",
        status: "Idle",
        color: "gray",
      };
    }
  }

  const statusDotColor = tracerBadge.color === "green" ? "bg-green-500" : "bg-gray-400";

  return (
    <header className="bg-surface flex justify-between items-center w-full px-margin-desktop h-16 border-b border-outline-variant shrink-0 z-50 sticky top-0">
      {/* Universal Logo Action */}
      <Link 
        href="/projects" 
        className="flex items-center gap-2 group cursor-pointer select-none"
      >
        <span className="material-symbols-outlined text-primary text-[28px] group-hover:scale-105 transition-transform" style={{ fontVariationSettings: "'FILL' 1" }}>
          precision_manufacturing
        </span>
        <span className="font-headline-sm text-headline-sm font-extrabold text-primary tracking-tight">
          Vertex Dynamics<span className="font-medium text-on-surface-variant/70 text-sm ml-2 hidden sm:inline">Scan-to-Path Hub</span>
        </span>
      </Link>

      {/* Middle/Right Status & Profile Controls */}
      <div className="flex items-center gap-4 lg:gap-6">
        {/* Mode Switch */}
        <IntegrationModeSwitch />

        {/* Status Badges */}
        <div className="hidden lg:flex items-center gap-3">
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-container-high border border-outline-variant text-[11px] font-semibold">
            <div className={`w-2 h-2 rounded-full ${statusDotColor} glowing-badge`}></div>
            <span className="font-label-md text-on-surface">{tracerBadge.label}: {tracerBadge.status}</span>
          </div>
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-container-high border border-outline-variant text-[11px] font-semibold">
            <div className="w-2 h-2 rounded-full bg-green-500 glowing-badge"></div>
            <span className="font-label-md text-on-surface">RobotStudio API: Connected</span>
          </div>
        </div>

        {/* Quick action icons */}
        <div className="flex items-center gap-2 text-primary">
          <button className="hover:bg-surface-container-low transition-colors p-2 rounded-full flex items-center justify-center" title="Sensor Status" aria-label="Sensor Status">
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>sensors</span>
          </button>
          <button className="hover:bg-surface-container-low transition-colors p-2 rounded-full flex items-center justify-center" title="Cloud Synced" aria-label="Cloud Synced">
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>cloud_done</span>
          </button>
        </div>

        {/* Log Out Profile Area */}
        {user && (
          <div className="flex items-center gap-3 pl-4 border-l border-outline-variant/60">
            <div className="flex flex-col text-right">
              <span className="font-label-md text-[11px] font-bold text-on-surface leading-none">{user}</span>
              <span className="text-[10px] text-on-surface-variant font-medium mt-0.5">Terminal Active</span>
            </div>
            <button 
              onClick={logout}
              className="bg-surface-container-high hover:bg-error-container hover:text-on-error-container text-on-surface-variant px-3 py-1.5 rounded-lg font-label-md text-xs font-bold transition-all duration-200 flex items-center gap-1.5 border border-outline-variant/50"
              title="Log Out Session"
              aria-label="Log Out Session"
            >
              <span className="material-symbols-outlined text-[14px]">logout</span>
              Log Out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
