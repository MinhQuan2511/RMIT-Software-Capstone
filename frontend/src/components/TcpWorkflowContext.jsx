"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  getWorkflowProgress,
  saveWorkflowProgress,
} from "@/services/tracerStudioTcpBridge";

const TcpWorkflowContext = createContext(null);

export function TcpWorkflowProvider({ children }) {
  const [progress, setProgress] = useState(null);
  const [sessionEvents, setSessionEvents] = useState([]);
  const [lastResponse, setLastResponse] = useState(null);

  const [acquisitionMethod, setAcquisitionMethod] = useState("manual");
  const [acquisitionQueue, setAcquisitionQueue] = useState([]);
  const [rawPayload, setRawPayload] = useState(null);
  const [canonicalWeldPath, setCanonicalWeldPath] = useState(null);
  const [isHydrated, setIsHydrated] = useState(false);

  // Safely hydrate context on client mount
  useEffect(() => {
    setIsHydrated(true);
    try {
      const savedProgress = getWorkflowProgress();
      if (savedProgress) setProgress(savedProgress);
    } catch (e) {
      console.warn("Client hydration access warning:", e.message);
    }
  }, []);

  // Reset workflow session when creating or selecting a project
  const resetWorkflowSession = useCallback(() => {
    setProgress({
      step1Complete: true,
      acquisitionComplete: false,
      parseComplete: false,
      generateComplete: false,
    });
    setRawPayload(null);
    setCanonicalWeldPath(null);
    setAcquisitionQueue([]);
    try {
      saveWorkflowProgress({ step1Complete: true });
    } catch (e) {
      console.warn("Error resetting session storage:", e.message);
    }
  }, []);

  const updateProgress = useCallback((updates) => {
    setProgress((prev) => {
      const next = { ...prev, ...updates };
      saveWorkflowProgress(next);
      return next;
    });
  }, []);

  const addSessionEvent = useCallback((event) => {
    setSessionEvents((prev) => [
      ...prev,
      { ...event, timestamp: new Date().toISOString() },
    ]);
  }, []);

  const clearSessionEvents = useCallback(() => {
    setSessionEvents([]);
  }, []);

  const setAcquisition = useCallback((method) => {
    setAcquisitionMethod(method);
  }, []);

  const setRawPayloadData = useCallback((payload) => {
    setRawPayload(payload);
  }, []);

  const setCanonicalPath = useCallback(
    (path) => {
      setCanonicalWeldPath(path);
      updateProgress({ parseComplete: true });
    },
    [updateProgress]
  );

  /**
   * STRICT STEP NAVIGATION GUARD
   *
   * The five-step chain: Project -> Acquire -> Parse & Map -> Generate -> Export.
   * Each step past the first unlocks on the artifact the previous one produces,
   * either from persisted progress or from live context state.
   *
   * Steps 1 and 2 are always open. Projects is the only entry point into the
   * workflow and it calls resetWorkflowSession on mount, so gating Acquire on a
   * progress flag could only ever lock someone out mid-hydration.
   */
  const canNavigateToStep = useCallback(
    (stepIndex) => {
      if (stepIndex === 1 || stepIndex === 2) return true;

      if (stepIndex === 3) {
        return !!(progress?.acquisitionComplete || rawPayload);
      }

      if (stepIndex === 4) {
        return !!(progress?.parseComplete || canonicalWeldPath);
      }

      if (stepIndex === 5) {
        return !!(progress?.generateComplete || progress?.step6Complete);
      }

      return false;
    },
    [progress, rawPayload, canonicalWeldPath]
  );

  const value = {
    isHydrated,
    canNavigateToStep,
    resetWorkflowSession,
    progress,
    updateProgress,
    sessionEvents,
    addSessionEvent,
    clearSessionEvents,
    lastResponse,
    setLastResponse,
    acquisitionMethod,
    setAcquisition,
    acquisitionQueue,
    setAcquisitionQueue,
    rawPayload,
    setRawPayloadData,
    canonicalWeldPath,
    setCanonicalPath,
  };

  return (
    <TcpWorkflowContext.Provider value={value}>
      {children}
    </TcpWorkflowContext.Provider>
  );
}

export function useTcpWorkflow() {
  const context = useContext(TcpWorkflowContext);
  if (!context) {
    return {
      isHydrated: true,
      canNavigateToStep: () => false,
      resetWorkflowSession: () => {},
      progress: getWorkflowProgress(),
      updateProgress: () => {},
      sessionEvents: [],
      addSessionEvent: () => {},
      clearSessionEvents: () => {},
      lastResponse: null,
      setLastResponse: () => {},
      acquisitionMethod: "manual",
      setAcquisition: () => {},
      acquisitionQueue: [],
      setAcquisitionQueue: () => {},
      rawPayload: null,
      setRawPayloadData: () => {},
      canonicalWeldPath: null,
      setCanonicalPath: () => {},
    };
  }
  return context;
}
