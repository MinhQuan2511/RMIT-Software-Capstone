"use client";

import React, { useState } from "react";
import { useAuth } from "@/components/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const [userId, setUserId] = useState("");
  const [securityCode, setSecurityCode] = useState("");
  const [selectedRole, setSelectedRole] = useState("operator"); // "operator" | "engineer"
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    setErrorMsg("");

    const res = login(userId, securityCode, selectedRole);
    if (res && !res.success) {
      setErrorMsg(res.error);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden bg-background">
      {/* Background Grid Pattern */}
      <div className="absolute inset-0 z-0 tech-grid opacity-30"></div>
      <div className="absolute top-0 left-0 w-[400px] h-[400px] bg-primary-fixed rounded-full blur-[100px] opacity-10 -translate-x-1/2 -translate-y-1/2"></div>

      {/* Login Surface Card */}
      <div className="relative z-10 w-full max-w-[440px] mx-margin-mobile bg-surface-container-lowest border border-outline-variant rounded-xl shadow-[0_12px_24px_-12px_rgba(0,0,0,0.1)] p-8 animate-entrance flex flex-col gap-6">
        {/* Header Logo */}
        <div className="flex flex-col items-center text-center gap-2 select-none">
          <div className="w-12 h-12 rounded-lg bg-surface-container-low flex items-center justify-center border border-outline-variant mb-2">
            <span 
              className="material-symbols-outlined text-primary text-3xl" 
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              precision_manufacturing
            </span>
          </div>
          <h1 className="font-extrabold text-2xl text-on-surface tracking-tight">Vertex Dynamics</h1>
          <p className="text-sm font-semibold text-on-surface-variant">Scan-to-Path Hub Authentication</p>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="bg-error-container/40 border border-error/20 text-error p-3 rounded-lg text-xs font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-base">error</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Role Toggle Selector */}
          <div className="flex p-1 bg-surface-container-low rounded-lg border border-outline-variant/50">
            <button
              type="button"
              onClick={() => setSelectedRole("operator")}
              className={`flex-1 py-2 rounded text-center font-bold text-xs transition-all ${
                selectedRole === "operator"
                  ? "bg-surface-container-lowest shadow-sm border border-outline-variant/20 text-on-surface"
                  : "text-on-surface-variant hover:text-on-surface border border-transparent"
              }`}
            >
              Standard Operator
            </button>
            <button
              type="button"
              onClick={() => setSelectedRole("engineer")}
              className={`flex-1 py-2 rounded text-center font-bold text-xs transition-all ${
                selectedRole === "engineer"
                  ? "bg-surface-container-lowest shadow-sm border border-outline-variant/20 text-on-surface"
                  : "text-on-surface-variant hover:text-on-surface border border-transparent"
              }`}
            >
              System Engineer
            </button>
          </div>

          {/* User Fields */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label 
                className="text-xs font-bold text-on-surface uppercase tracking-wider" 
                htmlFor="userId"
              >
                {selectedRole === "operator" ? "Operator ID" : "Engineer Email"}
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline pointer-events-none text-[20px]">
                  {selectedRole === "operator" ? "badge" : "mail"}
                </span>
                <input
                  id="userId"
                  type={selectedRole === "operator" ? "text" : "email"}
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder={selectedRole === "operator" ? "e.g., OP-7724" : "e.g., engineer@vertex.com"}
                  className="w-full h-10 pl-10 pr-3 bg-surface border border-outline-variant rounded text-sm text-on-surface placeholder:text-outline/70 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label 
                className="text-xs font-bold text-on-surface uppercase tracking-wider" 
                htmlFor="securityCode"
              >
                {selectedRole === "operator" ? "Security PIN" : "System Password"}
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline pointer-events-none text-[20px]">
                  lock
                </span>
                <input
                  id="securityCode"
                  type="password"
                  value={securityCode}
                  onChange={(e) => setSecurityCode(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-10 pl-10 pr-3 bg-surface border border-outline-variant rounded text-sm text-on-surface placeholder:text-outline/70 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Action Button */}
          <div className="flex flex-col gap-4 pt-2">
            <button
              type="submit"
              className="w-full h-10 bg-primary hover:bg-on-primary-fixed-variant text-on-primary rounded font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors active:scale-[0.98] cursor-pointer shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">login</span>
              Authenticate &amp; Initialize
            </button>

            <div className="flex justify-between items-center px-1 text-xs select-none">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary focus:ring-offset-background bg-surface cursor-pointer"
                />
                <span className="text-on-surface-variant group-hover:text-on-surface transition-colors font-semibold">
                  Remember terminal
                </span>
              </label>
              <a href="#" className="text-primary hover:underline transition-all font-semibold">
                Recovery Protocol
              </a>
            </div>
          </div>
        </form>

        {/* Footer Status info */}
        <div className="mt-2 pt-4 border-t border-outline-variant/50 flex justify-between items-center text-[11px] select-none">
          <div className="flex items-center gap-1.5 font-bold">
            <div className="w-2 h-2 rounded-full bg-[#10b981] glowing-badge"></div>
            <span className="text-on-surface-variant font-mono uppercase">SYS: ONLINE</span>
          </div>
          <span className="font-mono text-outline font-semibold">v2.4.1-stable</span>
        </div>
      </div>
    </div>
  );
}
