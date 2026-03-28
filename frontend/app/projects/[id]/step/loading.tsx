export default function StepLoading() {
  return (
    <div className="container py-6 animate-pulse">
      {/* Breadcrumb skeleton */}
      <div className="mb-4 flex items-center gap-2">
        <div className="h-4 w-20 rounded bg-gray-200" />
        <div className="h-4 w-4 rounded bg-gray-100" />
        <div className="h-4 w-32 rounded bg-gray-200" />
      </div>

      {/* Step bar skeleton */}
      <div className="mb-8 flex gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-8 flex-1 rounded-lg bg-gray-200" />
        ))}
      </div>

      {/* Content skeleton */}
      <div className="space-y-4">
        <div className="h-8 w-64 rounded bg-gray-200" />
        <div className="h-4 w-96 rounded bg-gray-100" />
        <div className="mt-6 rounded-xl border bg-gray-50 p-6">
          <div className="space-y-3">
            <div className="h-4 w-full rounded bg-gray-200" />
            <div className="h-4 w-3/4 rounded bg-gray-200" />
            <div className="h-4 w-5/6 rounded bg-gray-200" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="h-24 rounded-xl border bg-gray-50" />
          <div className="h-24 rounded-xl border bg-gray-50" />
        </div>
      </div>
    </div>
  );
}
