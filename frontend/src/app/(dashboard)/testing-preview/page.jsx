"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StepperProgress from "@/components/StepperProgress";
import { useToast } from "@/components/ToastContext";
import { useTestingWorkflow } from "@/components/TestingWorkflowContext";

export default function TestingPreviewPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { csvData, csvFileName, imageDataUrl, imageFileName } = useTestingWorkflow();

  // If no data, redirect
  if (!csvData || csvData.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center p-12 max-w-md">
          <span className="material-symbols-outlined text-primary/30 text-6xl mb-4 block">warning</span>
          <h3 className="text-lg font-extrabold text-on-surface mb-2">No Data Uploaded</h3>
          <p className="text-sm text-on-surface-variant mb-6">
            Please upload a CSV file and image first.
          </p>
          <Link
            href="/testing-upload"
            className="bg-primary text-on-primary px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-wider inline-flex items-center gap-2 hover:bg-surface-tint transition-colors"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            Go to Upload
          </Link>
        </div>
      </div>
    );
  }

  // Detect columns from first row
  const columns = Object.keys(csvData[0]);

  // Calculate coordinate range stats
  const stats = {};
  ["X", "Y", "Z"].forEach((axis) => {
    if (csvData[0][axis] !== undefined) {
      const values = csvData.map((r) => parseFloat(r[axis]) || 0);
      stats[axis] = {
        min: Math.min(...values).toFixed(2),
        max: Math.max(...values).toFixed(2),
      };
    }
  });

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative">
      {/* Left Panel: Coordinates Table (50%) */}
      <aside className="bg-surface-container-low border-r border-outline-variant shadow-sm flex flex-col w-[50%] h-full pt-6 px-5 gap-4 shrink-0 z-40 overflow-hidden">
        <div className="px-1 select-none">
          <h2 className="text-xl font-extrabold text-on-surface tracking-tight">
            Welding Path Preview
          </h2>
          <p className="text-xs text-on-surface-variant font-medium mt-1.5 leading-relaxed">
            Parsed {csvData.length} welding coordinates from <strong>{csvFileName}</strong>. Review before generating RAPID code.
          </p>
        </div>

        {/* Dynamic Workflow Progress Stepper */}
        <StepperProgress />

        <div className="h-px w-full bg-outline-variant/60 my-1 opacity-50"></div>

        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-3 shrink-0 select-none">
          <div className="bg-surface border border-outline-variant rounded-lg p-3 text-center">
            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block">Total Points</span>
            <span className="text-lg font-extrabold text-primary">{csvData.length}</span>
          </div>
          {stats.X && (
            <div className="bg-surface border border-outline-variant rounded-lg p-3 text-center">
              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block">X Range</span>
              <span className="text-[11px] font-mono font-bold text-on-surface">{stats.X.min} → {stats.X.max}</span>
            </div>
          )}
          {stats.Y && (
            <div className="bg-surface border border-outline-variant rounded-lg p-3 text-center">
              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block">Y Range</span>
              <span className="text-[11px] font-mono font-bold text-on-surface">{stats.Y.min} → {stats.Y.max}</span>
            </div>
          )}
        </div>

        {/* Scrollable Coordinate Table */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <div className="bg-inverse-surface rounded-xl border border-outline shadow-sm overflow-hidden flex-1 flex flex-col min-h-0">
            {/* Table Header */}
            <div className="bg-on-surface px-4 py-2.5 flex items-center justify-between border-b border-outline/30 shrink-0 select-none">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-inverse-on-surface text-sm">table_chart</span>
                <span className="font-label-md text-xs font-bold text-inverse-on-surface uppercase tracking-wider">
                  Coordinate Data Table
                </span>
              </div>
              <span className="bg-surface-container-lowest text-on-surface font-label-md text-[9px] font-extrabold px-2 py-0.5 rounded-sm uppercase tracking-wide">
                {csvData.length} ROWS
              </span>
            </div>

            {/* Table Content */}
            <div className="flex-1 overflow-auto code-scroll">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#2d3038] text-inverse-on-surface">
                    <th className="px-3 py-2 text-left font-bold text-[10px] uppercase tracking-wider border-b border-outline/20 w-12">
                      #
                    </th>
                    {columns.map((col) => (
                      <th
                        key={col}
                        className="px-3 py-2 text-left font-bold text-[10px] uppercase tracking-wider border-b border-outline/20"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {csvData.map((row, idx) => (
                    <tr
                      key={idx}
                      className={`border-b border-outline/10 transition-colors hover:bg-white/5 ${
                        idx % 2 === 0 ? "bg-[#1e222b]" : "bg-[#232730]"
                      }`}
                    >
                      <td className="px-3 py-2 font-mono text-on-surface-variant/50 font-bold text-[10px]">
                        {idx + 1}
                      </td>
                      {columns.map((col) => (
                        <td
                          key={col}
                          className="px-3 py-2 font-mono text-inverse-primary font-semibold"
                        >
                          {row[col]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex gap-4 select-none pb-4 shrink-0">
          <Link
            href="/testing-upload"
            className="flex-1 bg-surface border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            &lt; Back to Upload
          </Link>
          <Link
            href="/generate"
            className="flex-1 bg-primary text-on-primary hover:bg-surface-tint rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all select-none cursor-pointer"
          >
            Next: Generate
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </Link>
        </div>
      </aside>

      {/* Right Panel: Image Display */}
      <div className="flex-1 h-full relative bg-inverse-surface overflow-hidden">
        {/* Viewport-style header */}
        <div className="absolute top-4 left-4 right-4 flex justify-between items-start z-10 pointer-events-none">
          <div className="bg-surface/90 backdrop-blur-md border border-outline-variant rounded-lg p-2 pointer-events-auto shadow-lg flex items-center gap-3">
            <span className="material-symbols-outlined text-primary">image</span>
            <div className="flex flex-col">
              <span className="font-label-md text-[10px] text-on-surface-variant uppercase tracking-widest font-bold">
                Welding Path Reference
              </span>
              <span className="font-body-md text-[13px] text-on-surface font-semibold">
                {imageFileName || "No image uploaded"}
              </span>
            </div>
          </div>
        </div>

        {/* Grid background */}
        <div className="absolute inset-0 viewport-grid pointer-events-none"></div>

        {/* Image Display */}
        <div className="flex-1 w-full h-full flex items-center justify-center p-8 relative">
          {imageDataUrl ? (
            <img
              src={imageDataUrl}
              alt="Welding path reference"
              className="max-w-full max-h-full object-contain rounded-xl border border-outline-variant/30 shadow-2xl"
            />
          ) : (
            <div className="border-2 border-dashed border-outline-variant/40 rounded-xl p-12 text-center max-w-lg bg-surface/30 backdrop-blur-sm shadow-sm">
              <span className="material-symbols-outlined text-[48px] text-primary/40 mb-4 block">
                image
              </span>
              <h3 className="text-lg text-on-surface font-semibold mb-2">No Image Available</h3>
              <p className="text-sm text-on-surface-variant">
                Upload a welding path image in the previous step to see it here.
              </p>
            </div>
          )}
        </div>

        {/* Bottom coordinate summary HUD */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-surface/90 backdrop-blur-md border border-outline-variant rounded-full p-1.5 shadow-2xl z-10 pointer-events-auto select-none">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full text-on-surface-variant font-bold text-xs">
            <span className="material-symbols-outlined text-[18px] text-primary">scatter_plot</span>
            <span>{csvData.length} welding points</span>
          </div>
          {stats.Z && (
            <>
              <div className="w-[1px] h-4 bg-outline-variant/60"></div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-full text-on-surface-variant font-bold text-xs">
                <span className="material-symbols-outlined text-[18px]">height</span>
                <span>Z: {stats.Z.min} → {stats.Z.max}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
