"use client";

import React, { useEffect, useState } from "react";

export default function ToastNotification({ isOpen, title, message, type = "success", onClose }) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [animationClass, setAnimationClass] = useState("");

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setAnimationClass("toast-slide-in");
      
      const autoCloseTimer = setTimeout(() => {
        handleClose();
      }, 4000);

      return () => clearTimeout(autoCloseTimer);
    } else {
      if (shouldRender) {
        handleClose();
      }
    }
  }, [isOpen]);

  const handleClose = () => {
    setAnimationClass("toast-slide-out");
    const animTimer = setTimeout(() => {
      setShouldRender(false);
      if (onClose) onClose();
    }, 350); // Matches the 0.35s ease-in animation duration
    return () => clearTimeout(animTimer);
  };

  if (!shouldRender) return null;

  // Curated styles based on type
  const bgStyles = type === "success" 
    ? "bg-gradient-to-br from-[#065f46] to-[#047857] border-[#10b981]/40"
    : type === "error"
    ? "bg-gradient-to-br from-[#7f1d1d] to-[#991b1b] border-[#ef4444]/40"
    : "bg-gradient-to-br from-[#1e3a8a] to-[#1e40af] border-[#3b82f6]/40";

  const iconColor = type === "success" ? "text-[#6ee7b7]" : type === "error" ? "text-[#fca5a5]" : "text-[#93c5fd]";
  const iconName = type === "success" ? "check_circle" : type === "error" ? "cancel" : "info";

  return (
    <div 
      className={`fixed top-6 right-6 z-[9999] pointer-events-none ${animationClass}`}
    >
      <div className={`flex items-center gap-3.5 padding-gutter px-6 py-4 rounded-xl shadow-[0_20px_40px_rgba(0,0,0,0.15)] backdrop-blur-md border pointer-events-auto max-w-[520px] text-white ${bgStyles}`}>
        <span className={`material-symbols-outlined text-[28px] shrink-0 fill-icon ${iconColor}`}>
          {iconName}
        </span>
        <div className="flex flex-col text-[13px] font-medium leading-relaxed tracking-wide">
          <strong className="font-bold text-white block text-sm mb-0.5">{title}</strong>
          <span className="opacity-90">{message}</span>
        </div>
      </div>
    </div>
  );
}
