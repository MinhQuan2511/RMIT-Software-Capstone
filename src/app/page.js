"use client";

import React from "react";
import Link from "next/link";

export default function WelcomePage() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center relative overflow-hidden bg-background">
      {/* Background Layer */}
      <div className="absolute inset-0 z-0 tech-grid opacity-60"></div>
      <div className="absolute inset-0 z-0 bg-gradient-to-br from-surface-bright via-background to-surface-container-low opacity-90"></div>
      <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary-fixed rounded-full blur-[120px] opacity-20 -translate-y-1/2 translate-x-1/3"></div>

      {/* Main Content Area */}
      <div className="relative z-10 w-full max-w-[1400px] px-margin-desktop md:px-12 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center mt-[-5%]">
        {/* Left Side: Typography & Branding */}
        <div className="lg:col-span-8 flex flex-col gap-6 select-none">
          <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase tracking-[0.1em]">
            <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              school
            </span>
            <span>RMIT University Capstone 2026</span>
          </div>
          <h1 className="text-4xl md:text-[56px] md:leading-[1.1] font-extrabold text-on-surface tracking-tight">
            Vertex Dynamics: <br />
            <span className="text-primary bg-clip-text text-transparent bg-gradient-to-r from-primary to-surface-tint">
              Scan-to-Path Hub
            </span>
          </h1>
          <p className="text-base sm:text-lg text-on-surface-variant max-w-2xl mt-4">
            Next-Generation 3D Vision &amp; Industrial Robot Integration. A unified environment for scanning, path
            generation, and precision control.
          </p>
        </div>

        {/* Right Side: Status Card */}
        <div className="lg:col-span-4 flex justify-end">
          <div className="w-full max-w-sm bg-surface rounded-xl border border-outline-variant shadow-[0_8px_32px_rgba(0,0,0,0.04)] overflow-hidden backdrop-blur-sm bg-opacity-95">
            <div className="px-6 py-5 border-b border-surface-variant bg-surface-container-lowest flex items-center gap-3 select-none">
              <div className="w-8 h-8 rounded-lg bg-surface-container-low flex items-center justify-center text-primary border border-outline-variant/30">
                <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  dns
                </span>
              </div>
              <h2 className="font-bold text-on-surface text-base">System Status Overview</h2>
            </div>
            <div className="p-6 flex flex-col gap-4 bg-surface select-none">
              <div className="flex items-center justify-between p-3 rounded-lg border border-surface-container bg-surface-container-lowest">
                <div className="flex items-center gap-3 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[18px]">photo_camera</span>
                  <span className="font-medium text-sm">Camera Status</span>
                </div>
                <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-secondary-container bg-opacity-30">
                  <span className="w-2 h-2 rounded-full bg-secondary block"></span>
                  <span className="font-bold text-[10px] uppercase text-secondary">Standby</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border border-surface-container bg-surface-container-lowest">
                <div className="flex items-center gap-3 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[18px]">precision_manufacturing</span>
                  <span className="font-medium text-sm">Robot Bridge</span>
                </div>
                <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-error-container bg-opacity-30">
                  <span className="w-2 h-2 rounded-full bg-error block animate-pulse"></span>
                  <span className="font-bold text-[10px] uppercase text-error">Offline</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom: Action Button */}
      <div className="absolute bottom-20 w-full flex justify-center z-20 px-margin-desktop">
        <Link
          href="/login"
          className="group flex items-center gap-4 bg-primary hover:bg-on-primary-fixed-variant text-on-primary px-8 py-4 rounded-lg shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1"
        >
          <span className="font-bold text-xs tracking-wider uppercase">Enter Control System</span>
          <span className="material-symbols-outlined transition-transform duration-300 group-hover:translate-x-1">
            arrow_forward
          </span>
        </Link>
      </div>
    </div>
  );
}
