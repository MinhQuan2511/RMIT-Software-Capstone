"use client";

import React from "react";
import Sidebar from "@/components/Sidebar";
import { useAuth } from "@/components/AuthContext";
import { useRouter } from "next/navigation";

export default function DashboardLayout({ children }) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  // If not authenticated, the AuthContext will handle redirecting, 
  // but we should avoid rendering the sidebar frame briefly.
  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex flex-1 overflow-hidden w-full h-full relative">
      {/* Sidebar Navigation */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden bg-background">
        {children}
      </div>
    </div>
  );
}
