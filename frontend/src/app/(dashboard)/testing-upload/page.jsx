"use client";

import React, { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import StepperProgress from "@/components/StepperProgress";
import { useToast } from "@/components/ToastContext";
import { useTestingWorkflow } from "@/components/TestingWorkflowContext";
import { parseCsvText, MAX_ROWS } from "@/lib/pointListMapping";
import { Card, Icon } from "@/components/StatusPanels";

const MAX_SHEET_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;

function readSpreadsheet(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The file could not be read."));
    if (/\.csv$/i.test(file.name)) {
      reader.onload = () => resolve(parseCsvText(String(reader.result)));
      reader.readAsText(file);
    } else {
      reader.onload = () => {
        try {
          const wb = XLSX.read(reader.result, { type: "array", sheetRows: MAX_ROWS + 2 });
          const first = wb.SheetNames[0];
          if (!first) return resolve({ headers: [], rows: [], problems: ["The workbook has no sheets."] });
          const matrix = XLSX.utils.sheet_to_json(wb.Sheets[first], { header: 1, defval: "", raw: false });
          const nonEmpty = matrix.findIndex((r) => r.some((c) => String(c).trim() !== ""));
          if (nonEmpty < 0) return resolve({ headers: [], rows: [], problems: ["The first sheet is empty."] });
          const headers = matrix[nonEmpty].map((h) => String(h).trim());
          const rows = matrix.slice(nonEmpty + 1).map((r, i) => ({ __rowNumber: nonEmpty + i + 2, ...Object.fromEntries(headers.map((h, j) => [h, String(r[j] ?? "").trim()])) }))
            .filter((r) => headers.some((h) => r[h] !== ""));
          const problems = [];
          if (new Set(headers).size !== headers.length) problems.push("Header names are not unique; rename duplicate columns.");
          if (matrix.length > MAX_ROWS + 1) problems.push(`Only the first ${MAX_ROWS} rows were read.`);
          return resolve({ headers, rows, problems });
        } catch {
          return reject(new Error("The workbook could not be parsed. Check that it is a valid .xlsx or .xls file."));
        }
      };
      reader.readAsArrayBuffer(file);
    }
  });
}

export default function TestingUploadPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { sheet, image, setSheet, setImage } = useTestingWorkflow();
  const [sheetError, setSheetError] = useState(null);
  const [imageError, setImageError] = useState(null);
  const sheetInput = useRef(null);
  const imageInput = useRef(null);

  const onSheet = async (file) => {
    setSheetError(null);
    if (!file) return;
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) return setSheetError("Choose a .csv, .xlsx or .xls file.");
    if (file.size > MAX_SHEET_BYTES) return setSheetError(`The file is larger than ${MAX_SHEET_BYTES / 1024 / 1024} MB.`);
    try {
      const parsed = await readSpreadsheet(file);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setSheetError(parsed.problems.join(" ") || "No data rows found.");
        return;
      }
      setSheet({ fileName: file.name, sizeBytes: file.size, ...parsed });
      showToast("Spreadsheet read", `${parsed.rows.length} data rows from ${file.name}. Map the columns next.`, "success");
    } catch (err) {
      setSheetError(err.message);
    }
  };

  const onImage = (file) => {
    setImageError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) return setImageError("Choose an image file.");
    if (file.size > MAX_IMAGE_BYTES) return setImageError(`The image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
    const url = URL.createObjectURL(file);
    const probe = new window.Image();
    probe.onload = () => {
      if (probe.naturalWidth * probe.naturalHeight > MAX_IMAGE_PIXELS) {
        URL.revokeObjectURL(url);
        setImageError("The decoded image is too large (over 40 megapixels).");
        return;
      }
      setImage({ url, name: file.name, sizeBytes: file.size, width: probe.naturalWidth, height: probe.naturalHeight });
    };
    probe.onerror = () => { URL.revokeObjectURL(url); setImageError("The image could not be decoded."); };
    probe.src = url;
  };

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative min-h-0">
      <aside className="bg-surface-container-low border-r border-outline-variant flex flex-col w-[45%] min-w-[400px] h-full pt-5 px-5 gap-4 shrink-0 overflow-y-auto">
        <div>
          <h1 className="text-xl font-extrabold text-on-surface tracking-tight">Testing mode: upload a point list</h1>
          <p className="text-xs text-on-surface-variant mt-1">The spreadsheet is read in this browser. You map its columns and store it on the next step; nothing is defaulted silently.</p>
        </div>
        <StepperProgress />

        <Card title="Coordinates spreadsheet (CSV / XLSX)" icon="description">
          <button type="button" onClick={() => sheetInput.current && sheetInput.current.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onSheet(e.dataTransfer.files && e.dataTransfer.files[0]); }} className={`w-full flex flex-col items-center justify-center min-h-[130px] border-2 border-dashed rounded-lg p-5 ${sheet ? "border-green-500 bg-green-50/40" : "border-outline-variant hover:border-primary"}`}>
            <Icon name={sheet ? "check_circle" : "upload_file"} className={`text-3xl mb-1 ${sheet ? "text-green-600" : "text-primary/50"}`} />
            <span className="text-sm font-bold break-all">{sheet ? sheet.fileName : "Drop or choose a .csv, .xlsx or .xls file"}</span>
            <span className="text-[11px] text-on-surface-variant">{sheet ? `${sheet.rows.length} data rows · ${sheet.headers.length} columns` : `Up to 5 MB and ${MAX_ROWS} rows`}</span>
          </button>
          <input ref={sheetInput} type="file" accept=".csv,.xlsx,.xls" className="sr-only" aria-label="Choose spreadsheet" onChange={(e) => onSheet(e.target.files && e.target.files[0])} />
          {sheetError && <p className="text-xs text-red-800 mt-2" role="alert">{sheetError}</p>}
          {sheet && sheet.problems.length > 0 && <ul className="text-[11px] text-amber-900 mt-2 list-disc pl-5">{sheet.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </Card>

        <Card title="Reference image (optional, documentation only)" icon="image">
          <p className="text-[11px] text-on-surface-variant mb-2">An image is not calibration and not measured geometry. It is kept in memory for display and is lost on reload.</p>
          <button type="button" onClick={() => imageInput.current && imageInput.current.click()} className="w-full border-2 border-dashed border-outline-variant rounded-lg p-4 text-xs font-bold hover:border-primary">
            {image ? `Replace ${image.name}` : "Choose an image"}
          </button>
          <input ref={imageInput} type="file" accept="image/*" className="sr-only" aria-label="Choose reference image" onChange={(e) => onImage(e.target.files && e.target.files[0])} />
          {imageError && <p className="text-xs text-red-800 mt-2" role="alert">{imageError}</p>}
          {image && (
            <div className="mt-2 flex items-center gap-3">
              <Image src={image.url} alt={`Reference image ${image.name}`} width={96} height={64} unoptimized className="rounded border border-outline-variant object-contain h-16 w-24" />
              <span className="text-[11px] text-on-surface-variant">{image.width}×{image.height} px · {(image.sizeBytes / 1024).toFixed(0)} KB</span>
            </div>
          )}
        </Card>

        <button type="button" onClick={() => router.push("/testing-preview")} disabled={!sheet} className="w-full bg-primary disabled:bg-surface-container-high disabled:text-on-surface-variant text-on-primary rounded-xl py-3 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2">
          Next: map columns and review <Icon name="arrow_forward" className="text-[18px]" />
        </button>
        <div className="pb-4" />
      </aside>

      <div className="flex-1 h-full overflow-y-auto bg-background p-8">
        <div className="max-w-xl mx-auto flex flex-col gap-4">
          <h2 className="text-lg font-extrabold">Expected columns</h2>
          <p className="text-sm text-on-surface-variant">Positions in millimetres in the robot base frame (pre-calibrated). Orientation either as a quaternion q1..q4 = [w,x,y,z] or as Euler angles Rx, Ry, Rz in degrees applied as R = Rz·Ry·Rx. A row named <span className="font-mono">home</span> becomes the standby target; without one the module has no standby move.</p>
          <pre className="bg-inverse-surface text-inverse-on-surface rounded-lg p-3 text-[11px] font-mono overflow-x-auto">{`Name,X,Y,Z,Rx,Ry,Rz
home,800,0,600,0,180,0
P1,450.5,12.2,400.1,90,0,-90
P2,472.1,35.4,395.2,90,0,-90`}</pre>
          <p className="text-xs text-on-surface-variant">The same generator as File import produces the module: PROC main() calls Path_10, which visits the rows in order with MoveL. Robot configuration is either the explicit fixed [0,0,0,0] choice or per-row columns.</p>
        </div>
      </div>
    </div>
  );
}
