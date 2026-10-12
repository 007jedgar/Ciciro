import Landing from "@/components/landing/Landing";
import { homeShowsLibrary } from "@/lib/home";
import { LANDING_METADATA } from "@/components/landing/copy";

// Same landing page `/` shows a signed-out visitor, but reachable by a
// signed-in writer too (the app header and account menu link here). The
// answer depends on the visitor's session cookie.
export const dynamic = "force-dynamic";
export const metadata = LANDING_METADATA;

export default async function AboutPage() {
  return <Landing openApp={await homeShowsLibrary()} />;
}
