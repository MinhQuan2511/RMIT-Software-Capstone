"use client";

import React, { useEffect } from "react";

// Next 16.3 passes `retry` (earlier 16.x releases used `unstable_retry`); `reset` does not re-fetch.
export default function DashboardError({ error, retry: nextRetry, unstable_retry, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const retry = nextRetry || unstable_retry || reset;
  return (
    <div className="flex-1 flex items-center justify-center p-8 bg-background" role="alert">
      <div className="max-w-md text-center flex flex-col gap-3 items-center">
        <span className="material-symbols-outlined text-5xl text-error" aria-hidden="true">error</span>
        <h2 className="text-lg font-extrabold text-on-surface">This page failed to render</h2>
        <p className="text-sm text-on-surface-variant">
          No module was generated and no stored job was changed by this error. Technical details are in the browser console
          {error && error.digest ? ` (reference ${error.digest})` : ""}.
        </p>
        <button type="button" onClick={() => (retry ? retry() : window.location.reload())} className="bg-primary text-on-primary px-4 py-2 rounded-lg font-bold text-xs uppercase">
          Try again
        </button>
      </div>
    </div>
  );
}
