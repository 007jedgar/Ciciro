import type { Metadata } from "next";
import Landing from "@/components/landing/Landing";
import Library from "@/components/Library";
import { homeShowsLibrary } from "@/lib/home";
import { LANDING_METADATA } from "@/components/landing/copy";

// The answer depends on the visitor's session cookie.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return (await homeShowsLibrary()) ? { title: "Ciciro" } : LANDING_METADATA;
}

export default async function HomePage() {
  return (await homeShowsLibrary()) ? <Library /> : <Landing />;
}
