"use client";

import React, { useState } from "react";
import { useWorkflowSession } from "./WorkflowSessionContext";
import { isValidOperatorName } from "@/lib/sessionState";
import { Icon } from "./StatusPanels";

/**
 * Operator attribution. This is deliberately not a login: there is no password,
 * no account and no server-side session. The name is recorded on
 * acknowledgements, reviews, exports and reported evidence so they can be
 * attributed. Protection of the local API relies on loopback binding and
 * request checks in the backend, not on this screen.
 */
export default function OperatorGate({ onDone }) {
  const { operator, setOperator } = useWorkflowSession();
  const [name, setName] = useState(operator || "");
  const [error, setError] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (!isValidOperatorName(name)) {
      setError("Enter 1–64 letters, digits, spaces or . _ ' @ -");
      return;
    }
    setOperator(name.trim());
    if (onDone) onDone();
  };

  return (
    <div className="flex-1 w-full flex items-center justify-center bg-background p-6">
      <form onSubmit={submit} className="w-full max-w-[440px] bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-8 flex flex-col gap-5" aria-labelledby="operator-title">
        <div className="flex flex-col items-center text-center gap-2">
          <Icon name="badge" className="text-primary text-4xl" />
          <h1 id="operator-title" className="font-extrabold text-2xl text-on-surface tracking-tight">Local operator session</h1>
          <p className="text-sm text-on-surface-variant">
            Enter your name so acknowledgements, reviews and exports can be attributed to you.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="operator-name" className="text-xs font-bold text-on-surface uppercase tracking-wider">Operator name</label>
          <input
            id="operator-name"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(""); }}
            autoComplete="name"
            maxLength={64}
            aria-invalid={!!error}
            aria-describedby="operator-help"
            className="w-full h-10 px-3 bg-surface border border-outline-variant rounded text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary"
          />
          {error && <p className="text-xs text-error font-semibold" role="alert">{error}</p>}
          <p id="operator-help" className="text-[11px] text-on-surface-variant leading-relaxed">
            This is attribution, not authentication. There is no password and no user account. The application is
            intended for one operator on this computer; its backend accepts requests only from this machine.
          </p>
        </div>
        <button type="submit" className="w-full h-10 bg-primary hover:bg-on-primary-fixed-variant text-on-primary rounded font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          <Icon name="arrow_forward" className="text-[18px]" />Continue
        </button>
      </form>
    </div>
  );
}
