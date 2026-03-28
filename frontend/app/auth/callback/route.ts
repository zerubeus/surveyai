import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }

    const errorParams = new URLSearchParams({
      error: "auth_callback_error",
      error_description: error.message,
    });
    return NextResponse.redirect(
      `${origin}/auth/error?${errorParams.toString()}`,
    );
  }

  return NextResponse.redirect(
    `${origin}/auth/error?error=missing_code&error_description=No+authorization+code+provided`,
  );
}
