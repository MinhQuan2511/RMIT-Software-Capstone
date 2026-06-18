"use client";

import React, { useRef } from "react";
import { useToast } from "./ToastContext";

export default function RAPIDCodeEditor({ 
  code = "", 
  title = "ABB RAPID OUTPUT", 
  status = "Generated",
  onCopySuccess = null,
}) {
  const { showToast } = useToast();
  const codeRef = useRef(null);

  const handleCopy = () => {
    if (!code) return;

    navigator.clipboard.writeText(code).then(() => {
      showToast(
        "✓ RAPID Module Copied!",
        "RAPID code has been copied to your system clipboard. Ready for RobotStudio."
      );
      if (onCopySuccess) onCopySuccess();
    }).catch(err => {
      console.error("Clipboard copy failed:", err);
      // Fallback implementation
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        showToast(
          "✓ RAPID Module Copied!",
          "RAPID code has been copied to your system clipboard. Ready for RobotStudio."
        );
        if (onCopySuccess) onCopySuccess();
      } catch (e) {
        console.error("Fallback copy failed:", e);
      }
      document.body.removeChild(ta);
    });
  };

  return (
    <section className="bg-inverse-surface rounded-xl border border-outline shadow-sm flex flex-col flex-1 overflow-hidden relative min-h-[300px]">
      {/* Code Header */}
      <header className="bg-on-surface px-4 py-3 flex justify-between items-center border-b border-outline/30 shrink-0 select-none">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-inverse-on-surface text-sm">code</span>
          <span className="font-label-md text-xs font-bold text-inverse-on-surface uppercase tracking-wider">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="bg-surface-container-lowest text-on-surface font-label-md text-[9px] font-extrabold px-2 py-0.5 rounded-sm uppercase tracking-wide">
            {status}
          </span>
          <button 
            onClick={handleCopy}
            className="text-inverse-primary hover:text-white transition-colors p-1 rounded hover:bg-white/10 flex items-center justify-center"
            title="Copy RAPID code to clipboard"
          >
            <span className="material-symbols-outlined text-[16px]">content_copy</span>
          </button>
        </div>
      </header>

      {/* Code Area */}
      <div className="p-4 overflow-y-auto flex-1 font-code-md text-[13px] text-inverse-primary leading-relaxed code-scroll bg-[#1e222b]">
        <pre className="m-0 font-mono"><code ref={codeRef}>{code}</code></pre>
      </div>
    </section>
  );
}
