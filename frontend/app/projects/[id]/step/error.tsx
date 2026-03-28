"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function StepError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error("Step error:", error);
  }, [error]);

  return (
    <div className="container max-w-2xl py-16">
      <Card className="border-red-200 bg-red-50">
        <CardContent className="p-8 text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-400" />
          <h2 className="mb-2 text-xl font-semibold text-red-900">
            Something went wrong loading this step
          </h2>
          <p className="mb-6 text-sm text-red-700">
            {error.message?.includes("fetch") || error.message?.includes("network")
              ? "Network error — check your connection and try again."
              : error.message?.slice(0, 120) || "An unexpected error occurred."}
          </p>
          {error.digest && (
            <p className="mb-4 font-mono text-xs text-red-400">
              Error ID: {error.digest}
            </p>
          )}
          <div className="flex justify-center gap-3">
            <Button onClick={reset} className="gap-2 bg-red-600 hover:bg-red-700">
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/dashboard")}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
