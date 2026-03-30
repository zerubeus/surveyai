import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { NewProjectFlow } from "@/components/projects/NewProjectFlow";

export default async function NewProjectPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Get user's organization (first one they belong to)
  const { data: membershipRaw } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  const membership = membershipRaw as { organization_id: string } | null;

  if (!membership) {
    // User has no organization — create one automatically
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — supabase rpc type inference
    const { data: org, error: orgError } = await supabase.rpc(
      "create_org_with_owner" as never,
      {
        p_name: `${user.email?.split("@")[0] ?? "User"}'s Organization`,
        p_slug: `org-${user.id.slice(0, 8)}`,
      } as never,
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

    return <NewProjectFlow organizationId={org as string} />;
  }

  return <NewProjectFlow organizationId={membership.organization_id} />;
}
