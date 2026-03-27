export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">SurveyAI Analyst</h1>
          <p className="mt-2 text-muted-foreground">
            Sign in to your account
          </p>
        </div>
        {/* Auth form will be implemented in Sprint 2 */}
        <div className="rounded-lg border p-6 text-center text-muted-foreground">
          Authentication UI — Sprint 2
        </div>
      </div>
    </div>
  );
}
