"use client";

import React, { useState } from "react";
import { useToast } from "./ToastContext";
import { Icon } from "./StatusPanels";

/**
 * Read-only view of the stored module bytes for a revision. Editing is not
 * supported: an edited module would have to become a new revision and be
 * re-checked, so the generated text is shown exactly as stored.
 */
export default function RAPIDCodeEditor({ code = "", title = "ABB RAPID MODULE", statusText = "", outputSha256 = null }) {
  const { showToast } = useToast();
  const [copy, setCopy] = useState(null);

  const handleCopy = async () => {
    if (!code) return;
    try {
      if (!navigator.clipboard) throw new Error("unavailable");
      await navigator.clipboard.writeText(code);
      setCopy("copied");
      showToast("Copied", "Module text copied to the clipboard.", "success");
    } catch {
      setCopy("denied");
      showToast("Clipboard not available", "The browser did not allow clipboard access. Select the text manually or use Download.", "error");
    }
  };

  return (
    <section className="bg-inverse-surface rounded-xl border border-outline shadow-sm flex flex-col flex-1 overflow-hidden min-h-[280px]" aria-label={title}>
      <header className="bg-on-surface px-4 py-2.5 flex flex-wrap gap-2 justify-between items-center border-b border-outline/30 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name="code" className="text-inverse-on-surface text-sm" />
          <span className="text-xs font-bold text-inverse-on-surface uppercase tracking-wider truncate">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          {statusText && <span className="bg-surface-container-lowest text-on-surface text-[9px] font-extrabold px-2 py-0.5 rounded-sm uppercase tracking-wide">{statusText}</span>}
          <button type="button" onClick={handleCopy} disabled={!code} className="text-inverse-primary hover:text-white p-1 rounded hover:bg-white/10 flex items-center gap-1 text-[10px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" aria-label="Copy module text to clipboard">
            <Icon name={copy === "copied" ? "check" : copy === "denied" ? "block" : "content_copy"} className="text-[16px]" />
            <span>{copy === "copied" ? "Copied" : copy === "denied" ? "Copy blocked" : "Copy"}</span>
          </button>
        </div>
      </header>
      {outputSha256 && <p className="px-4 py-1 bg-[#262a33] text-[10px] font-mono text-slate-300 break-all">SHA-256 {outputSha256}</p>}
      <div className="p-4 overflow-auto flex-1 text-[12px] text-inverse-primary leading-relaxed code-scroll bg-[#1e222b]" tabIndex={0} aria-label="Module text (read-only)">
        <pre className="m-0 font-mono whitespace-pre"><code>{code || "No module is available for the current selection."}</code></pre>
      </div>
    </section>
  );
}
