"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const STEPS = [
  { path: "/projects", label: "Project", icon: "folder_open" },
  { path: "/calibrate", label: "Calibrate", icon: "tune" },
  { path: "/configure", label: "Configure", icon: "settings_input_component" },
  { path: "/preview", label: "Preview", icon: "visibility" },
  { path: "/generate", label: "Generate", icon: "precision_manufacturing" },
  { path: "/export", label: "Export & Run", icon: "rocket_launch" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="bg-surface-container-low flex flex-col w-[280px] h-full pt-6 px-4 gap-2 border-r border-outline-variant shadow-sm z-40 shrink-0 select-none">
      <div className="mb-6 px-3">
        <h2 className="font-headline-md text-xl font-extrabold text-on-surface leading-tight">Control Center</h2>
        <p className="font-label-md text-[10px] text-on-surface-variant font-bold uppercase mt-1.5 tracking-widest">
          Workflow Steps
        </p>
      </div>
      
      <ul className="flex flex-col gap-1.5 w-full">
        {STEPS.map((step) => {
          const isActive = pathname === step.path;
          return (
            <li key={step.path}>
              <Link
                href={step.path}
                className={`flex items-center gap-3.5 px-4 py-3 rounded-xl font-semibold transition-all duration-150 ${
                  isActive
                    ? "bg-primary-container text-on-primary-container shadow-sm transform scale-[0.98]"
                    : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                }`}
              >
                <span 
                  className="material-symbols-outlined text-lg"
                  style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
                >
                  {step.icon}
                </span>
                <span className="font-label-md text-sm">{step.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
