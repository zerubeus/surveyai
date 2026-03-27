import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { ProjectContextForm } from "@/components/projects/ProjectContextForm";

export default async function NewProjectPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Get user's organization (first one they belong to)
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) {
    // User has no organization — create one automatically
    const { data: org, error: orgError } = await supabase.rpc(
      "create_org_with_owner",
      {
        p_name: `${user.email?.split("@")[0] ?? "User"}'s Organization`,
        p_slug: `org-${user.id.slice(0, 8)}`,
      },
    );

    if (orgError || !org) {
      return (
        <div className="container py-10">
          <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
            Failed to set up your organization. Please try again or contact
            support.
          </div>
        </div>
      );
    }

    return (
      <div className="container max-w-3xl py-10">
        <h1 className="text-3xl font-bold">New Project</h1>
        <p className="mt-1 text-muted-foreground">
          Define the context for your survey analysis
        </p>
        <div className="mt-8">
          <ProjectContextForm organizationId={org as string} />
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-3xl py-10">
      <h1 className="text-3xl font-bold">New Project</h1>
      <p className="mt-1 text-muted-foreground">
        Define the context for your survey analysis
      </p>
      <div className="mt-8">
        <ProjectContextForm organizationId={membership.organization_id} />
      </div>
    </div>
  );
}
