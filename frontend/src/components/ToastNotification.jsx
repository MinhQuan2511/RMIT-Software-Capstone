"use client";

import React from "react";

const STYLES = {
  success: { box: "bg-gradient-to-br from-[#065f46] to-[#047857] border-[#10b981]/40", icon: "check_circle", iconColor: "text-[#6ee7b7]", label: "Success" },
  error: { box: "bg-gradient-to-br from-[#7f1d1d] to-[#991b1b] border-[#ef4444]/40", icon: "cancel", iconColor: "text-[#fca5a5]", label: "Error" },
  info: { box: "bg-gradient-to-br from-[#1e3a8a] to-[#1e40af] border-[#3b82f6]/40", icon: "info", iconColor: "text-[#93c5fd]", label: "Notice" },
};

/** Presentational only; timing lives in lib/toastController. */
export default function ToastNotification({ toast, phase, onClose }) {
  const style = toast ? STYLES[toast.type] || STYLES.info : null;
  return (
    <div className="fixed top-6 right-6 z-[9999] pointer-events-none" aria-live={toast && toast.type === "error" ? "assertive" : "polite"} role="status">
      {toast && (
        <div className={`${phase === "exiting" ? "toast-slide-out" : "toast-slide-in"} flex items-start gap-3.5 px-5 py-4 rounded-xl shadow-[0_20px_40px_rgba(0,0,0,0.15)] backdrop-blur-md border pointer-events-auto max-w-[520px] text-white ${style.box}`}>
          <span className={`material-symbols-outlined text-[26px] shrink-0 ${style.iconColor}`} aria-hidden="true">{style.icon}</span>
          <div className="flex flex-col text-[13px] font-medium leading-relaxed tracking-wide min-w-0">
            <strong className="font-bold text-white block text-sm mb-0.5"><span className="sr-only">{style.label}: </span>{toast.title}</strong>
            <span className="opacity-90 break-words">{toast.message}</span>
          </div>
          <button type="button" onClick={onClose} className="ml-2 shrink-0 rounded p-1 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" aria-label="Dismiss notification">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
          </button>
        </div>
      )}
    </div>
  );
}
