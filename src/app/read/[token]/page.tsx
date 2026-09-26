import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReaderView from "@/components/ReaderView";
import { openSharedManuscript } from "@/lib/shares";

export const dynamic = "force-dynamic";

// The token is in the URL: keep it out of search indexes and out of the
// Referer header of anything the page links to.
export const metadata: Metadata = {
  title: "Beta read · Ciciro",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function isUnavailable(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (error as { name?: string }).name === "AuthError" &&
    (error as { status?: number }).status === 404
  );
}

// /read/:token — the read-only page a beta reader opens. No session: the
// token decides what, if anything, is shown.
export default async function ReaderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let manuscript;
  try {
    manuscript = await openSharedManuscript(token);
  } catch (error) {
    if (isUnavailable(error)) notFound();
    throw error;
  }
  return <ReaderView token={token} manuscript={manuscript} />;
}
