"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import ToastNotification from "./ToastNotification";
import { createToastController } from "@/lib/toastController";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [state, setState] = useState({ toast: null, phase: "hidden" });
  const controllerRef = useRef(null);
  if (controllerRef.current === null) {
    controllerRef.current = createToastController({ onChange: (s) => setState(s) });
  }

  useEffect(() => {
    const controller = controllerRef.current;
    return () => controller.destroy();
  }, []);

  const [api] = useState(() => ({
    showToast: (title, message, type = "success") => controllerRef.current.show(title, message, type),
    hideToast: () => controllerRef.current.dismiss(),
  }));

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastNotification toast={state.toast} phase={state.phase} onClose={api.hideToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return context;
}
