import type { Metadata } from "next";
import Landing from "@/components/landing/Landing";
import { homeShowsLibrary } from "@/lib/home";
import { LANDING_METADATA } from "@/components/landing/copy";

// Same landing page `/` shows a signed-out visitor, but reachable by a
// signed-in writer too (the app header and account menu link here). The
// answer depends on the visitor's session cookie. Byte-for-byte the same
// content as `/`, so the canonical tag points search engines back there.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { ...LANDING_METADATA, alternates: { canonical: "/" } };

export default async function AboutPage() {
  return <Landing openApp={await homeShowsLibrary()} />;
}
