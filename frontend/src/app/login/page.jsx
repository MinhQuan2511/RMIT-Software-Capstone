"use client";

import React from "react";
import { useRouter } from "next/navigation";
import OperatorGate from "@/components/OperatorGate";

export default function OperatorPage() {
  const router = useRouter();
  return (
    <div className="min-h-screen w-full flex relative bg-background">
      <div className="absolute inset-0 z-0 tech-grid opacity-30" aria-hidden="true"></div>
      <div className="relative z-10 flex-1 flex">
        <OperatorGate onDone={() => router.push("/projects")} />
      </div>
    </div>
  );
}
