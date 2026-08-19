"use client";

import React from "react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-on-background p-6 text-center select-none">
      <h2 className="text-3xl font-bold mb-2">404 - Page Not Found</h2>
      <p className="text-on-surface-variant mb-6">Could not find the requested page or resource.</p>
      <Link
        href="/projects"
        className="px-4 py-2 bg-primary text-on-primary rounded-lg font-semibold shadow hover:opacity-90 transition-opacity"
      >
        Return to Projects
      </Link>
    </div>
  );
}
