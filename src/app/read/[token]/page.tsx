import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReaderView from "@/components/ReaderView";
import { openSharedManuscript, sharePreviewInfo } from "@/lib/shares";
import { sharePreviewParts, sharePreviewSentence } from "@/lib/share-preview";

export const dynamic = "force-dynamic";

// The token is in the URL: keep it out of search indexes and out of the
// Referer header of anything the page links to. The preview text and image
// (opengraph-image.tsx in this folder) are the one exception - they say only
// what the link already shows its reader (author display name, title), and
// only while the link is still active; see sharePreviewInfo.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const base: Metadata = {
    title: "Beta read · Ciciro",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
  const { token } = await params;
  const info = await sharePreviewInfo(token);
  if (!info) return base;
  const parts = sharePreviewParts(info);
  const description = sharePreviewSentence(parts);
  return {
    ...base,
    openGraph: { title: parts.title, description, type: "website" },
    twitter: { card: "summary_large_image", title: parts.title, description },
  };
}

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
