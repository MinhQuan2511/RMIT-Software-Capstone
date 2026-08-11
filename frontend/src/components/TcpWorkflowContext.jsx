"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  getBridgeConfig,
  saveBridgeConfig,
  getWorkflowProgress,
  saveWorkflowProgress,
} from "@/services/tracerStudioTcpBridge";

const TcpWorkflowContext = createContext(null);

export function TcpWorkflowProvider({ children }) {
  const [bridgeConfig, setBridgeConfig] = useState(null);
  const [progress, setProgress] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("idle");
  const [sessionEvents, setSessionEvents] = useState([]);
  const [lastResponse, setLastResponse] = useState(null);

  // Workflow mode: 'undecided' | 'tcp' | 'file'
  const [workflowMode, setWorkflowModeState] = useState("undecided");
  const [acquisitionMethod, setAcquisitionMethod] = useState("manual");
  const [acquisitionQueue, setAcquisitionQueue] = useState([]);
  const [rawPayload, setRawPayload] = useState(null);
  const [canonicalWeldPath, setCanonicalWeldPath] = useState(null);
  const [isHydrated, setIsHydrated] = useState(false);

  // Safely hydrate context on client mount
  useEffect(() => {
    setIsHydrated(true);
    try {
      const savedConfig = getBridgeConfig();
      if (savedConfig) setBridgeConfig(savedConfig);

      const savedProgress = getWorkflowProgress();
      if (savedProgress) setProgress(savedProgress);

      const savedMode = localStorage.getItem("vertex_workflow_mode");
      if (savedMode) {
        setWorkflowModeState(savedMode);
      } else {
        setWorkflowModeState("undecided");
      }
    } catch (e) {
      console.warn("Client hydration access warning:", e.message);
    }
  }, []);

  // Reset workflow session when creating or selecting a project
  const resetWorkflowSession = useCallback(() => {
    setWorkflowModeState("undecided");
    setProgress({
      step1Complete: true,
      step2Complete: false,
      connectionComplete: false,
      acquisitionComplete: false,
      parseComplete: false,
      generateComplete: false,
    });
    setRawPayload(null);
    setCanonicalWeldPath(null);
    setAcquisitionQueue([]);
    try {
      localStorage.removeItem("vertex_workflow_mode");
      saveWorkflowProgress({ step1Complete: true });
    } catch (e) {
      console.warn("Error resetting session storage:", e.message);
    }
  }, []);

  const setWorkflowMode = useCallback((mode) => {
    setWorkflowModeState(mode);
    try {
      localStorage.setItem("vertex_workflow_mode", mode);
    } catch (e) {
      console.warn("Failed saving workflow mode to LocalStorage:", e.message);
    }
  }, []);

  const updateBridgeConfig = useCallback((updates) => {
    setBridgeConfig((prev) => {
      const next = { ...prev, ...updates };
      saveBridgeConfig(next);
      return next;
    });
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

  const setConnection = useCallback(
    (status) => {
      setConnectionStatus(status);
      if (status === "connected") {
        updateProgress({ connectionComplete: true });
      }
    },
    [updateProgress]
  );

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
   */
  const canNavigateToStep = useCallback(
    (stepIndex) => {
      if (stepIndex === 1 || stepIndex === 2) return true;

      if (workflowMode === "undecided" || !workflowMode) return false;

      if (stepIndex === 3) {
        if (workflowMode !== "tcp") return false;
        return !!(progress?.step2Complete || progress?.bridgeSetupComplete);
      }

      if (stepIndex === 4) {
        if (workflowMode === "file") {
          return !!(progress?.step2Complete || progress?.bridgeSetupComplete);
        }
        if (workflowMode === "tcp") {
          return !!(progress?.connectionComplete || connectionStatus === "connected");
        }
        return false;
      }

      if (stepIndex === 5) {
        return !!(progress?.acquisitionComplete || rawPayload);
      }

      if (stepIndex === 6) {
        return !!(progress?.parseComplete || canonicalWeldPath);
      }

      if (stepIndex === 7) {
        return !!(progress?.generateComplete || progress?.step6Complete);
      }

      return false;
    },
    [workflowMode, progress, connectionStatus, rawPayload, canonicalWeldPath]
  );

  const value = {
    isHydrated,
    workflowMode,
    setWorkflowMode,
    canNavigateToStep,
    resetWorkflowSession,
    bridgeConfig,
    updateBridgeConfig,
    progress,
    updateProgress,
    connectionStatus,
    setConnection,
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
      workflowMode: "undecided",
      setWorkflowMode: () => {},
      canNavigateToStep: () => false,
      resetWorkflowSession: () => {},
      bridgeConfig: getBridgeConfig(),
      updateBridgeConfig: () => {},
      progress: getWorkflowProgress(),
      updateProgress: () => {},
      connectionStatus: "idle",
      setConnection: () => {},
      sessionEvents: [],
      addSessionEvent: () => {},
      clearSessionEvents: () => {},
      lastResponse: null,
      setLastResponse: () => {},
      acquisitionMethod: "live-tcp",
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