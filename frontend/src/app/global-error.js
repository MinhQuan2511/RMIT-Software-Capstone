"use client";

import React from "react";

// Replaces the root layout when it fails. The raw error message is not shown
// to the browser; details go to the console.
export default function GlobalError({ error, retry: nextRetry, unstable_retry, reset }) {
  if (typeof console !== "undefined") console.error(error);
  const retry = nextRetry || unstable_retry || reset;
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning style={{ fontFamily: "system-ui, sans-serif", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>The application failed to load</h2>
          <p style={{ fontSize: 14, color: "#414754" }}>
            No data was generated or changed. Details are in the browser console{error && error.digest ? ` (reference ${error.digest})` : ""}.
          </p>
          <button type="button" onClick={() => (retry ? retry() : window.location.reload())} style={{ marginTop: 12, padding: "8px 16px", background: "#005bbf", color: "#fff", border: 0, borderRadius: 8, fontWeight: 600 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
