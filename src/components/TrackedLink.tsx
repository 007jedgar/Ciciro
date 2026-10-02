"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";
import { getAnalytics } from "@/lib/analytics-client";

type LinkProps = ComponentProps<typeof Link>;

/**
 * next/link that also fires cta_clicked, for a marketing or in-app button
 * that is not already covered by a more specific event (a feature event, or
 * paywall_cta_clicked). `cta` is a stable id for this exact button; give two
 * places that render "the same" button (e.g. a repeated nav vs. hero CTA)
 * distinct ids so click-through breaks down by placement. See docs/analytics.md.
 */
export default function TrackedLink({
  cta,
  surface,
  onClick,
  ...props
}: LinkProps & { cta: string; surface: string; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <Link
      {...props}
      onClick={(event) => {
        getAnalytics().track("cta_clicked", { cta, surface });
        onClick?.(event);
      }}
    />
  );
}
