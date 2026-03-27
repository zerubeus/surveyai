import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  return (
    <div className="container mx-auto py-10">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <p className="mt-2 text-muted-foreground">
        Welcome to SurveyAI Analyst. Your projects will appear here.
      </p>
      {/* Project list will be implemented in Sprint 2 */}
      <div className="mt-8 rounded-lg border p-6 text-center text-muted-foreground">
        Project list — Sprint 2
      </div>
    </div>
  );
}
