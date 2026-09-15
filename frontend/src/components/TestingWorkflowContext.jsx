"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const TestingWorkflowContext = createContext(null);

/**
 * In-memory staging for Testing mode before a point list is stored.
 *
 * The parsed sheet lives only in memory until the operator stores it as a
 * backend source; after that the source (and any job) survives reloads. The
 * optional reference image is documentation only — never calibration or
 * geometry — and is kept as an object URL in memory, never in localStorage.
 */
export function TestingWorkflowProvider({ children }) {
  const [sheet, setSheetState] = useState(null); // { fileName, headers, rows, problems }
  const [image, setImageState] = useState(null); // { url, name, sizeBytes }
  const imageRef = useRef(null);

  const setSheet = useCallback((next) => setSheetState(next), []);
  const setImage = useCallback((next) => {
    if (imageRef.current) URL.revokeObjectURL(imageRef.current.url);
    imageRef.current = next;
    setImageState(next);
  }, []);
  const clearAll = useCallback(() => {
    setSheetState(null);
    if (imageRef.current) URL.revokeObjectURL(imageRef.current.url);
    imageRef.current = null;
    setImageState(null);
  }, []);

  useEffect(() => () => { if (imageRef.current) URL.revokeObjectURL(imageRef.current.url); }, []);

  return (
    <TestingWorkflowContext.Provider value={{ sheet, image, setSheet, setImage, clearAll }}>
      {children}
    </TestingWorkflowContext.Provider>
  );
}

export function useTestingWorkflow() {
  const ctx = useContext(TestingWorkflowContext);
  if (!ctx) throw new Error("useTestingWorkflow must be used inside TestingWorkflowProvider");
  return ctx;
}
