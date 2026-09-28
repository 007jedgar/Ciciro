"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";

export default function BackLink({ fallback }: { fallback: string }) {
  const router = useRouter();

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (window.history.length <= 1) return;
    event.preventDefault();
    router.back();
  }

  return (
    <Link href={fallback} className="privacy-back" onClick={onClick}>
      Back
    </Link>
  );
}
