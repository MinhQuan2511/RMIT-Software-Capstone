"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/services/apiClient";
import { shortHash } from "@/lib/statusLabels";
import { Card, DiagnosticsList, Icon, InlineError, StateBadge } from "./StatusPanels";

const num = (v) => (Number.isFinite(v) ? (v !== 0 && Math.abs(v) < 1e-3 ? v.toExponential(3) : Number(v.toFixed(9)).toString()) : "—");

function CalibrationDetail({ detail }) {
  const i = detail.inspection;
  const m = i.matrices.find((x) => x.key === i.candidateTransformKey) || i.matrices[0];
  return (
    <div className="flex flex-col gap-3 mt-3 border-t border-outline-variant/40 pt-3" aria-label="Calibration inspection">
      <div className="flex flex-wrap gap-2 items-center text-[11px]">
        <span className="font-mono font-bold">{i.file.displayName}</span>
        <span className="font-mono text-on-surface-variant" title={i.file.sha256}>SHA-256 {shortHash(i.file.sha256)} · {i.file.sizeBytes} B (exact bytes stored)</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
        <span className="flex flex-col gap-1"><span className="font-bold">Numerical consistency check</span><StateBadge value={i.numericalCheck} /></span>
        <span className="flex flex-col gap-1"><span className="font-bold">Physical calibration</span><StateBadge value={i.physicalCalibrationStatus} /></span>
        <span className="flex flex-col gap-1"><span className="font-bold">Application of the transform</span><StateBadge value={i.activation.status} /></span>
      </div>
      {!i.parse.ok && <DiagnosticsList diagnostics={i.parse.diagnostics} />}
      {i.scalars.length > 0 && (
        <p className="text-[11px]"><span className="font-bold">Scalar fields:</span> {i.scalars.map((s) => `${s.key} = ${JSON.stringify(s.value)} (meaning ${s.meaning})`).join("; ")}</p>
      )}
      {m && (
        <>
          <p className="text-[11px]"><span className="font-bold">Matrix</span> <span className="font-mono">{m.key}</span> · {m.rows}×{m.cols} · dt {m.dt} ({m.dtName}){m.precisionNote ? ` · ${m.precisionNote}` : ""}</p>
          {m.matrix && (
            <div className="overflow-x-auto">
              <table className="text-[11px] font-mono border-collapse" aria-label="Imported 4 by 4 matrix">
                <tbody>{m.matrix.map((row, r) => <tr key={r}>{row.map((v, c) => <td key={c} className="px-2 py-0.5 text-right border border-outline-variant/30">{num(v)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          <ul className="text-[11px] flex flex-col gap-0.5">
            {m.checks.map((c) => <li key={c.id} className="flex items-start justify-between gap-2"><span><span className="font-mono text-[10px]">{c.id}</span> {c.message}</span><StateBadge value={c.status} compact /></li>)}
          </ul>
          {m.metrics && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
              <dt className="font-bold">‖RᵀR − I‖_F</dt><dd className="font-mono">{num(m.metrics.orthogonalityFrobenius)} (tolerance {i.tolerances.orthogonalityFrobenius})</dd>
              <dt className="font-bold">det(R)</dt><dd className="font-mono">{m.metrics.determinant.toFixed(10)} (|det − 1| tolerance {i.tolerances.determinantAbsError})</dd>
              <dt className="font-bold">Bottom-row deviation</dt><dd className="font-mono">{num(m.metrics.bottomRowMaxAbsDeviation)} (tolerance {i.tolerances.bottomRowMaxAbsDeviation})</dd>
              <dt className="font-bold">Translation</dt><dd className="font-mono">[{m.metrics.translation.map(num).join(", ")}] · units unknown</dd>
            </dl>
          )}
          <p className="text-[10px] text-on-surface-variant">{i.metricDefinitions.note}</p>
        </>
      )}
      <div className="border border-amber-300 bg-amber-50 text-amber-950 rounded p-2 text-[11px]">
        <p className="font-bold flex items-center gap-1"><Icon name="block" className="text-[15px]" />Not applied. {i.activation.reason}</p>
        <p className="mt-1 font-semibold">Missing before any transform could be used:</p>
        <ul className="list-disc pl-5">{i.activation.missingForActivation.map((x) => <li key={x}>{x}</li>)}</ul>
      </div>
      {i.companions.map((c) => (
        <div key={c.sha256} className="text-[11px] border border-outline-variant/40 rounded p-2">
          <p><span className="font-bold">Companion {c.displayName}</span> · SHA-256 {shortHash(c.sha256)} · parse {c.parse}{c.problem ? ` (${c.problem})` : ""}</p>
          {c.observations.map((o, k) => <p key={k} className="font-mono text-[10px]">{o.field || (o.fields || []).join(", ")}: {JSON.stringify(o.value ?? o.values)}{o.euclideanNorm !== undefined ? ` · norm ${o.euclideanNorm.toFixed(6)}` : ""} — {o.note}</p>)}
          {c.interpretation && <p className="text-[10px] text-on-surface-variant mt-1">{c.interpretation}</p>}
        </div>
      ))}
    </div>
  );
}

/** Import and inspect OpenCV YAML calibration files. Inspection only; nothing is applied. */
export default function CalibrationImport() {
  const [list, setList] = useState({ data: null, error: null });
  const [nonce, setNonce] = useState(0);
  const [yamlFile, setYamlFile] = useState(null);
  const [cfigFile, setCfigFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.listCalibrations()
      .then((d) => { if (!cancelled) setList({ data: d.calibrations, error: null }); })
      .catch((err) => { if (!cancelled) setList({ data: null, error: err }); });
    return () => { cancelled = true; };
  }, [nonce]);

  const upload = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.importCalibration(yamlFile, cfigFile);
      setDetail(r);
      setNonce((n) => n + 1);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const open = async (id) => {
    setError(null);
    try { setDetail(await api.getCalibration(id)); } catch (err) { setError(err); }
  };

  return (
    <Card title="Import a calibration file (inspection only)" icon="grid_on">
      <p className="text-[12px] text-on-surface-variant leading-relaxed">
        Reads an OpenCV FileStorage YAML file (for example a hand-eye matrix) and checks it numerically: 4×4 shape, numeric type,
        16 finite values, bottom row, rotation orthogonality and determinant. The exact bytes and their hash are stored. The file’s
        frames, direction, units and calibration record are not in the file, so the transform is never applied and the calibration
        is never marked validated. This is not a calibration solver and does not measure accuracy.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3 text-[11px]">
        <label className="flex flex-col gap-1 font-bold">Calibration file (.yml / .yaml, ≤ 64 KB)
          <input type="file" accept=".yml,.yaml" aria-label="Choose calibration YAML file" onChange={(e) => setYamlFile(e.target.files && e.target.files[0])} className="font-normal text-xs" />
        </label>
        <label className="flex flex-col gap-1 font-bold">Companion metadata, e.g. Cfig (optional, ≤ 64 KB)
          <input type="file" aria-label="Choose companion metadata file" onChange={(e) => setCfigFile(e.target.files && e.target.files[0])} className="font-normal text-xs" />
        </label>
      </div>
      <button type="button" onClick={upload} disabled={!yamlFile || busy} className="mt-2 bg-primary disabled:opacity-50 text-on-primary rounded-lg px-4 py-2 text-xs font-bold uppercase">
        {busy ? "Inspecting…" : "Inspect and store"}
      </button>
      <InlineError error={error || list.error} />

      {list.data && list.data.length > 0 && (
        <table className="w-full text-[11px] mt-3">
          <caption className="text-left font-bold text-on-surface-variant pb-1">Imported calibration files</caption>
          <thead><tr className="text-left border-b border-outline-variant/40"><th scope="col">File</th><th scope="col">SHA-256</th><th scope="col">Numerical check</th><th scope="col">Physical</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {list.data.map((c) => (
              <tr key={c.id} className="border-b border-outline-variant/15">
                <td className="font-mono break-all pr-2">{c.displayName}</td>
                <td className="font-mono pr-2" title={c.sha256}>{shortHash(c.sha256)}</td>
                <td className="pr-2"><StateBadge value={c.numericalCheck} compact /></td>
                <td className="pr-2"><StateBadge value={c.physicalCalibrationStatus} compact /></td>
                <td><button type="button" onClick={() => open(c.id)} className="text-primary font-bold underline">Inspect</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {detail && <CalibrationDetail detail={detail} />}
    </Card>
  );
}
