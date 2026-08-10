"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getBridgeConfig, saveBridgeConfig, getWorkflowProgress, saveWorkflowProgress } from "@/services/tracerStudioTcpBridge";

const TcpWorkflowContext = createContext(null);

function getInitialBridgeConfig() {
  try {
    return getBridgeConfig();
  } catch {
    return null;
  }
}

function getInitialProgress() {
  try {
    return getWorkflowProgress();
  } catch {
    return null;
  }
}

function getInitialConnectionStatus(progress) {
  try {
    if (progress?.connectionComplete) return "connected";
  } catch {
    // ignore
  }
  return "idle";
}

export function TcpWorkflowProvider({ children }) {
  const [bridgeConfig, setBridgeConfig] = useState(getInitialBridgeConfig);
  const [progress, setProgress] = useState(getInitialProgress);
  const [connectionStatus, setConnectionStatus] = useState(() => getInitialConnectionStatus(getInitialProgress()));
  const [sessionEvents, setSessionEvents] = useState([]);
  const [lastResponse, setLastResponse] = useState(null);
  const [acquisitionMethod, setAcquisitionMethod] = useState("live-tcp"); // "live-tcp" | "watched-folder" | "manual"
  const [acquisitionQueue, setAcquisitionQueue] = useState([]);
  const [rawPayload, setRawPayload] = useState(null);
  const [canonicalWeldPath, setCanonicalWeldPath] = useState(null);
  // isHydrated starts true since we use lazy initializers that read localStorage synchronously
  const [isHydrated] = useState(true);

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
    setSessionEvents((prev) => {
      const next = [...prev, { ...event, timestamp: new Date().toISOString() }];
      return next;
    });
  }, []);

  const clearSessionEvents = useCallback(() => {
    setSessionEvents([]);
  }, []);

  const setConnection = useCallback((status) => {
    setConnectionStatus(status);
    if (status === "connected") {
      updateProgress({ connectionComplete: true });
    }
  }, [updateProgress]);

  const setAcquisition = useCallback((method) => {
    setAcquisitionMethod(method);
  }, []);

  const setRawPayloadData = useCallback((payload) => {
    setRawPayload(payload);
  }, []);

  const setCanonicalPath = useCallback((path) => {
    setCanonicalWeldPath(path);
    updateProgress({ parseComplete: true });
  }, [updateProgress]);

  const value = {
    isHydrated,
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
    setLastResponse: setLastResponse,
    acquisitionMethod,
    setAcquisition,
    acquisitionQueue,
    setAcquisitionQueue,
    rawPayload,
    setRawPayloadData,
    canonicalWeldPath,
    setCanonicalPath,
  };

  if (!isHydrated) return null;

  return (
    <TcpWorkflowContext.Provider value={value}>
      {children}
    </TcpWorkflowContext.Provider>
  );
}

export function useTcpWorkflow() {
  const context = useContext(TcpWorkflowContext);
  // Return safe defaults during SSR / before hydration
  if (!context) {
    return {
      isHydrated: true,
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
