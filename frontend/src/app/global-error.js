"use client";

import React from "react";

export default function GlobalError({ error, reset }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning className="bg-background text-on-background min-h-screen flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <h2 className="text-2xl font-bold">Something went wrong!</h2>
          {error?.message && (
            <p className="text-sm text-on-surface-variant max-w-md font-mono bg-surface-container p-3 rounded">
              {error.message}
            </p>
          )}
          <button
            onClick={() => reset()}
            className="px-4 py-2 bg-primary text-on-primary rounded-lg font-semibold shadow hover:opacity-90 transition-opacity"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
