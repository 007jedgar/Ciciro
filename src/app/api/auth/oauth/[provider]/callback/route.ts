import { NextRequest, NextResponse } from "next/server";
import { isSocialProvider } from "@/lib/auth/social-config";
import { finishBrowserSignIn } from "@/lib/auth/social-sign-in";

export const runtime = "nodejs";

type Params = { params: Promise<{ provider: string }> };

// GET /api/auth/oauth/google/callback — Google returns with ?code&state.
export async function GET(req: NextRequest, { params }: Params) {
  const { provider } = await params;
  if (provider !== "google") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const query = req.nextUrl.searchParams;
  return finishBrowserSignIn(req, provider, {
    state: query.get("state"),
    code: query.get("code"),
    idToken: null,
    error: query.get("error"),
    user: null,
  });
}

// POST /api/auth/oauth/apple/callback — Apple's form_post: code, id_token,
// state, and on the first authorization only, `user` with the name.
export async function POST(req: NextRequest, { params }: Params) {
  const { provider } = await params;
  if (!isSocialProvider(provider) || provider !== "apple") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const form = await req.formData().catch(() => null);
  const field = (name: string) => {
    const value = form?.get(name);
    return typeof value === "string" ? value : null;
  };
  return finishBrowserSignIn(req, provider, {
    state: field("state"),
    code: field("code"),
    idToken: field("id_token"),
    error: field("error"),
    user: field("user"),
  });
}
