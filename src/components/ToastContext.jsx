"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import ToastNotification from "./ToastNotification";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState({
    isOpen: false,
    message: "",
    title: "",
    type: "success", // "success" | "error" | "info"
  });

  const showToast = useCallback((title, message, type = "success") => {
    setToast({
      isOpen: true,
      title,
      message,
      type,
    });
  }, []);

  const hideToast = useCallback(() => {
    setToast((prev) => ({ ...prev, isOpen: false }));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      <ToastNotification
        isOpen={toast.isOpen}
        title={toast.title}
        message={toast.message}
        type={toast.type}
        onClose={hideToast}
      />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
