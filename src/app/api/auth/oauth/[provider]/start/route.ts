import { NextRequest, NextResponse } from "next/server";
import { isSocialProvider } from "@/lib/auth/social-config";
import { startBrowserSignIn } from "@/lib/auth/social-sign-in";

export const runtime = "nodejs";

type Params = { params: Promise<{ provider: string }> };

// GET /api/auth/oauth/:provider/start — redirect to Apple or Google.
// `?next=/path` on the web; `?client=native&challenge=<S256>` from the app.
export async function GET(req: NextRequest, { params }: Params) {
  const { provider } = await params;
  if (!isSocialProvider(provider)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return startBrowserSignIn(req, provider);
}
