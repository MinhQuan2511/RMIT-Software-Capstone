"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getWorkflowSteps, getValidRoutes, SHARED_ROUTES } from "@/config/workflows";

const IntegrationModeContext = createContext(null);

const STORAGE_KEY = "vd_tracerstudio_mode";
const DEFAULT_MODE = "api";

function getInitialMode() {
  try {
    const stored = typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY);
    if (stored === "api" || stored === "tcp" || stored === "testing") return stored;
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_MODE;
}

export function IntegrationModeProvider({ children }) {
  const [mode, setModeState] = useState(getInitialMode);
  // isHydrated starts true since we use lazy initializers that read localStorage synchronously
  const [isHydrated] = useState(true);

  const setMode = useCallback((newMode) => {
    if (newMode !== "api" && newMode !== "tcp" && newMode !== "testing") return;
    try {
      localStorage.setItem(STORAGE_KEY, newMode);
    } catch {
      // localStorage unavailable
    }
    setModeState(newMode);
  }, []);

  const workflowSteps = getWorkflowSteps(mode);
  const validRoutes = getValidRoutes(mode);

  // tracerStatus is derived from mode and TCP connection state
  let tracerStatus;
  if (mode === "api") {
    tracerStatus = { label: "TracerStudio API", status: "Connected", color: "green" };
  } else if (mode === "testing") {
    tracerStatus = { label: "Testing Mode", status: "Active", color: "amber" };
  } else {
    tracerStatus = { label: "TracerStudio Bridge", status: "Idle", color: "gray" };
  }

  const value = {
    mode,
    setMode,
    isHydrated,
    workflowSteps,
    validRoutes,
    SHARED_ROUTES,
    tracerStatus,
  };

  // Prevent rendering until hydrated to avoid flash of wrong mode
  if (!isHydrated) return null;

  return (
    <IntegrationModeContext.Provider value={value}>
      {children}
    </IntegrationModeContext.Provider>
  );
}

export function useIntegrationMode() {
  const context = useContext(IntegrationModeContext);
  // Return safe defaults during SSR / before hydration
  if (!context) {
    return {
      mode: "api",
      setMode: () => {},
      isHydrated: true,
      workflowSteps: getWorkflowSteps("api"),
      validRoutes: getValidRoutes("api"),
      SHARED_ROUTES,
      tracerStatus: { label: "TracerStudio API", status: "Connected", color: "green" },
    };
  }
  return context;
}
