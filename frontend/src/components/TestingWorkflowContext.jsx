"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

const TestingWorkflowContext = createContext(null);

export function TestingWorkflowProvider({ children }) {
  const [csvData, setCsvDataState] = useState(null); // Array of coordinate objects
  const [csvFileName, setCsvFileName] = useState("");
  const [imageDataUrl, setImageDataUrlState] = useState(null); // Data URL string
  const [imageFileName, setImageFileName] = useState("");

  const setCsvData = useCallback((data, fileName) => {
    setCsvDataState(data);
    setCsvFileName(fileName || "");
  }, []);

  const setImageDataUrl = useCallback((dataUrl, fileName) => {
    setImageDataUrlState(dataUrl);
    setImageFileName(fileName || "");
  }, []);

  const clearAll = useCallback(() => {
    setCsvDataState(null);
    setCsvFileName("");
    setImageDataUrlState(null);
    setImageFileName("");
  }, []);

  const value = {
    csvData,
    csvFileName,
    imageDataUrl,
    imageFileName,
    setCsvData,
    setImageDataUrl,
    clearAll,
  };

  return (
    <TestingWorkflowContext.Provider value={value}>
      {children}
    </TestingWorkflowContext.Provider>
  );
}

export function useTestingWorkflow() {
  const context = useContext(TestingWorkflowContext);
  if (!context) {
    return {
      csvData: null,
      csvFileName: "",
      imageDataUrl: null,
      imageFileName: "",
      setCsvData: () => {},
      setImageDataUrl: () => {},
      clearAll: () => {},
    };
  }
  return context;
}
