"use client";

import React from "react";
import { useIntegrationMode } from "./IntegrationModeContext";

export default function IntegrationModeSwitch() {
  const { mode, setMode } = useIntegrationMode();

  const modes = ["api", "tcp", "testing"];

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const currentIndex = modes.indexOf(mode);
      const nextIndex = (currentIndex + 1) % modes.length;
      setMode(modes[nextIndex]);
    }
  };

  return (
    <div
      role="tablist"
      aria-label="TracerStudio Integration Mode"
      className="flex items-center bg-surface-container-high border border-outline-variant rounded-lg p-0.5 gap-0.5"
    >
      <button
        role="tab"
        aria-selected={mode === "api"}
        aria-label="TracerStudio API mode"
        tabIndex={mode === "api" ? 0 : -1}
        onClick={() => setMode("api")}
        onKeyDown={handleKeyDown}
        className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all duration-200 whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-1 focus:ring-offset-background ${
          mode === "api"
            ? "bg-primary text-on-primary shadow-sm"
            : "text-on-surface-variant hover:text-on-surface"
        }`}
      >
        TracerStudio: API
      </button>
      <button
        role="tab"
        aria-selected={mode === "tcp"}
        aria-label="TracerStudio TCP mode"
        tabIndex={mode === "tcp" ? 0 : -1}
        onClick={() => setMode("tcp")}
        onKeyDown={handleKeyDown}
        className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all duration-200 whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-1 focus:ring-offset-background ${
          mode === "tcp"
            ? "bg-primary text-on-primary shadow-sm"
            : "text-on-surface-variant hover:text-on-surface"
        }`}
      >
        TracerStudio: TCP
      </button>
      <button
        role="tab"
        aria-selected={mode === "testing"}
        aria-label="Testing mode"
        tabIndex={mode === "testing" ? 0 : -1}
        onClick={() => setMode("testing")}
        onKeyDown={handleKeyDown}
        className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all duration-200 whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:ring-offset-1 focus:ring-offset-background ${
          mode === "testing"
            ? "bg-amber-500 text-white shadow-sm"
            : "text-on-surface-variant hover:text-on-surface"
        }`}
      >
        Testing
      </button>
    </div>
  );
}
