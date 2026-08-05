"use client";

import React, { useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import { useAuth } from "@/components/AuthContext";
import { useIntegrationMode } from "@/components/IntegrationModeContext";
import { TcpWorkflowProvider } from "@/components/TcpWorkflowContext";
import { TestingWorkflowProvider } from "@/components/TestingWorkflowContext";
import { IntegrationModeProvider } from "@/components/IntegrationModeContext";
import { VALID_ROUTES } from "@/config/workflows";
import { useRouter, usePathname } from "next/navigation";

function DashboardContent({ children }) {
  const { isAuthenticated } = useAuth();
  const { mode, validRoutes } = useIntegrationMode();
  const router = useRouter();
  const pathname = usePathname();

  // If not authenticated, the AuthContext will handle redirecting, 
  // but we should avoid rendering the sidebar frame briefly.
  if (!isAuthenticated) {
    return null;
  }

  // Route guard: if current route is not valid in this mode, redirect to /projects
  useEffect(() => {
    if (pathname && !validRoutes.has(pathname)) {
      router.push("/projects");
    }
  }, [pathname, validRoutes, router]);

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

export default function DashboardLayout({ children }) {
  return (
    <TcpWorkflowProvider>
      <TestingWorkflowProvider>
        <DashboardContent>{children}</DashboardContent>
      </TestingWorkflowProvider>
    </TcpWorkflowProvider>
  );
}
