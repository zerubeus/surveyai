"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="container py-16 text-center">
      <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-400" />
      <h2 className="mb-2 text-xl font-semibold">Dashboard failed to load</h2>
      <p className="mb-6 text-sm text-gray-600">{error.message?.slice(0, 100) || "Unknown error"}</p>
      <Button onClick={reset} className="gap-2">
        <RefreshCw className="h-4 w-4" />
        Reload dashboard
      </Button>
    </div>
  );
}
