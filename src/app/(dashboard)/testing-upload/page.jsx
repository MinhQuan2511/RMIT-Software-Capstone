"use client";

import React, { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StepperProgress from "@/components/StepperProgress";
import { useToast } from "@/components/ToastContext";
import { useTestingWorkflow } from "@/components/TestingWorkflowContext";

/**
 * Parse a CSV string into an array of objects.
 * Expects headers like: X, Y, Z, Rx, Ry, Rz (flexible with whitespace).
 */
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim());
    if (values.length < headers.length) continue;
    if (values.every((v) => v === "")) continue;

    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx];
    });
    rows.push(row);
  }
  return rows;
}

export default function TestingUploadPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { csvData, csvFileName, imageDataUrl, imageFileName, setCsvData, setImageDataUrl } =
    useTestingWorkflow();

  const [csvDragOver, setCsvDragOver] = useState(false);
  const [imgDragOver, setImgDragOver] = useState(false);
  const csvInputRef = useRef(null);
  const imgInputRef = useRef(null);

  // CSV file handler
  const handleCsvFile = useCallback(
    (file) => {
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".csv")) {
        showToast("❌ Invalid File", "Please upload a CSV file (.csv extension).", "error");
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        const parsed = parseCsv(text);
        if (parsed.length === 0) {
          showToast("❌ Empty CSV", "Could not parse any data rows from this CSV file.", "error");
          return;
        }
        setCsvData(parsed, file.name);
        showToast(
          "✓ CSV Loaded",
          `Parsed ${parsed.length} coordinate rows from "${file.name}".`,
          "success"
        );
      };
      reader.readAsText(file);
    },
    [setCsvData, showToast]
  );

  // Image file handler
  const handleImageFile = useCallback(
    (file) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        showToast("❌ Invalid File", "Please upload an image file (PNG, JPG, etc.).", "error");
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        setImageDataUrl(e.target.result, file.name);
        showToast("✓ Image Loaded", `"${file.name}" ready for preview.`, "success");
      };
      reader.readAsDataURL(file);
    },
    [setImageDataUrl, showToast]
  );

  // Drag and drop handlers for CSV
  const handleCsvDrop = (e) => {
    e.preventDefault();
    setCsvDragOver(false);
    const file = e.dataTransfer.files?.[0];
    handleCsvFile(file);
  };

  // Drag and drop handlers for Image
  const handleImgDrop = (e) => {
    e.preventDefault();
    setImgDragOver(false);
    const file = e.dataTransfer.files?.[0];
    handleImageFile(file);
  };

  const bothUploaded = csvData && csvData.length > 0 && imageDataUrl;

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative">
      {/* Left Sidebar Panel (45%) */}
      <aside className="bg-surface-container-low border-r border-outline-variant shadow-sm flex flex-col w-[45%] h-full pt-6 px-5 gap-4 shrink-0 z-40 overflow-y-auto">
        <div className="px-1 select-none">
          <h2 className="text-xl font-extrabold text-on-surface tracking-tight">
            Upload Welding Data
          </h2>
          <p className="text-xs text-on-surface-variant font-medium mt-1.5 leading-relaxed">
            Upload a CSV file with welding coordinates and an image of the welding path to begin testing.
          </p>
        </div>

        {/* Dynamic Workflow Progress Stepper */}
        <StepperProgress />

        <div className="h-px w-full bg-outline-variant/60 my-1 opacity-50"></div>

        {/* Upload Zones */}
        <div className="flex-1 flex flex-col gap-5 pb-6">
          {/* CSV Upload Zone */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">description</span>
              CSV Welding Coordinates
            </h3>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setCsvDragOver(true);
              }}
              onDragLeave={() => setCsvDragOver(false)}
              onDrop={handleCsvDrop}
              onClick={() => csvInputRef.current?.click()}
              className={`flex flex-col items-center justify-center min-h-[140px] border-2 border-dashed rounded-lg p-6 cursor-pointer transition-all duration-200 ${
                csvDragOver
                  ? "border-primary bg-primary-fixed/20 scale-[1.01]"
                  : csvData
                  ? "border-green-400 bg-green-50/30"
                  : "border-outline-variant hover:border-primary hover:bg-surface-container-low"
              }`}
            >
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => handleCsvFile(e.target.files?.[0])}
              />
              {csvData ? (
                <>
                  <span className="material-symbols-outlined text-green-500 text-3xl mb-2" style={{ fontVariationSettings: "'FILL' 1" }}>
                    check_circle
                  </span>
                  <span className="text-sm font-bold text-on-surface">{csvFileName}</span>
                  <span className="text-[11px] text-on-surface-variant font-medium mt-1">
                    {csvData.length} coordinate rows parsed
                  </span>
                  <span className="text-[10px] text-primary font-semibold mt-2 underline">
                    Click to replace
                  </span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-primary/40 text-4xl mb-2">
                    upload_file
                  </span>
                  <span className="text-sm font-bold text-on-surface">
                    Drop CSV file here
                  </span>
                  <span className="text-[11px] text-on-surface-variant font-medium mt-1">
                    or click to browse — expects X, Y, Z, Rx, Ry, Rz columns
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Image Upload Zone */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-tertiary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-tertiary">image</span>
              Welding Path Image
            </h3>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setImgDragOver(true);
              }}
              onDragLeave={() => setImgDragOver(false)}
              onDrop={handleImgDrop}
              onClick={() => imgInputRef.current?.click()}
              className={`flex flex-col items-center justify-center min-h-[140px] border-2 border-dashed rounded-lg p-6 cursor-pointer transition-all duration-200 ${
                imgDragOver
                  ? "border-tertiary bg-tertiary-fixed/20 scale-[1.01]"
                  : imageDataUrl
                  ? "border-green-400 bg-green-50/30"
                  : "border-outline-variant hover:border-tertiary hover:bg-surface-container-low"
              }`}
            >
              <input
                ref={imgInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleImageFile(e.target.files?.[0])}
              />
              {imageDataUrl ? (
                <>
                  <img
                    src={imageDataUrl}
                    alt="Welding path preview"
                    className="max-h-[80px] rounded-md border border-outline-variant mb-2 object-contain"
                  />
                  <span className="text-sm font-bold text-on-surface">{imageFileName}</span>
                  <span className="text-[10px] text-primary font-semibold mt-2 underline">
                    Click to replace
                  </span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-tertiary/40 text-4xl mb-2">
                    add_photo_alternate
                  </span>
                  <span className="text-sm font-bold text-on-surface">
                    Drop image here
                  </span>
                  <span className="text-[11px] text-on-surface-variant font-medium mt-1">
                    or click to browse — PNG, JPG, BMP supported
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Navigation Buttons */}
          <div className="mt-auto flex gap-4 select-none">
            <button
              onClick={() => router.push("/testing-preview")}
              disabled={!bothUploaded}
              className={`flex-1 rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all select-none ${
                bothUploaded
                  ? "bg-primary text-on-primary hover:bg-surface-tint cursor-pointer"
                  : "bg-surface-variant border border-outline-variant text-on-surface-variant opacity-40 cursor-not-allowed"
              }`}
            >
              Next: Preview Path
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Right Panel — Summary / Instructions */}
      <div className="flex-1 h-full relative bg-background overflow-y-auto">
        <div className="flex flex-col items-center justify-center h-full p-12 gap-6 text-center max-w-lg mx-auto">
          <div className="w-20 h-20 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <span className="material-symbols-outlined text-amber-500 text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>
              science
            </span>
          </div>
          <div>
            <h3 className="text-xl font-extrabold text-on-surface mb-2 tracking-tight">
              Testing Mode
            </h3>
            <p className="text-sm text-on-surface-variant font-medium leading-relaxed">
              Upload welding coordinates (CSV) and a reference image of the welding path. The system will parse the coordinates, display them alongside the image, and generate ABB RAPID code for the robot controller.
            </p>
          </div>
          <div className="bg-surface border border-outline-variant rounded-xl p-5 w-full text-left">
            <h4 className="font-bold text-xs text-on-surface mb-3 uppercase tracking-wider flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-base">info</span>
              Expected CSV Format
            </h4>
            <pre className="bg-inverse-surface text-inverse-on-surface rounded-lg p-3 text-[11px] font-mono overflow-x-auto leading-relaxed">
{`X,Y,Z,Rx,Ry,Rz
450.5,12.2,400.1,90.0,0.0,-90.0
472.1,35.4,395.2,90.0,0.0,-90.0
510.3,48.7,388.5,85.0,5.0,-88.0`}
            </pre>
          </div>
          {/* Upload status summary */}
          {(csvData || imageDataUrl) && (
            <div className="bg-surface border border-outline-variant rounded-xl p-4 w-full flex flex-col gap-2 animate-entrance">
              <h4 className="font-bold text-xs text-on-surface uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-green-500 text-base" style={{ fontVariationSettings: "'FILL' 1" }}>task_alt</span>
                Upload Status
              </h4>
              <div className="flex items-center gap-2 text-xs font-semibold">
                <span className={`w-2 h-2 rounded-full ${csvData ? "bg-green-500" : "bg-gray-300"}`}></span>
                <span className={csvData ? "text-on-surface" : "text-on-surface-variant/50"}>
                  CSV: {csvData ? `${csvFileName} (${csvData.length} points)` : "Not uploaded"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold">
                <span className={`w-2 h-2 rounded-full ${imageDataUrl ? "bg-green-500" : "bg-gray-300"}`}></span>
                <span className={imageDataUrl ? "text-on-surface" : "text-on-surface-variant/50"}>
                  Image: {imageDataUrl ? imageFileName : "Not uploaded"}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
