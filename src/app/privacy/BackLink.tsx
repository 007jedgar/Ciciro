"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { shouldGoBack } from "@/lib/back-link";

export default function BackLink({ fallback }: { fallback: string }) {
  const router = useRouter();

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (window.history.length <= 1) return;
    // A visitor who reached this page through the auth middleware's redirect
    // (e.g. "What's new" while signed out, bounced through /login) has that
    // page sitting right behind this one in history; router.back() would
    // send them there instead of where "Back" should actually go.
    if (!shouldGoBack(document.referrer, window.location.origin)) return;
    event.preventDefault();
    router.back();
  }

  return (
    <Link href={fallback} className="privacy-back" onClick={onClick}>
      Back
    </Link>
  );
}
