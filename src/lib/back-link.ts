import { isAuthPagePath } from "@/lib/auth/constants";

// Pure decision logic for BackLink.tsx (src/app/privacy/BackLink.tsx), split
// out so it can be unit tested without mounting the component. A "Back"
// control must never land a visitor on a sign-in/sign-up/recovery page: a
// page like /changelog that's public but sits behind the auth middleware for
// a signed-out visitor can have /login right behind it in history (the
// middleware's redirect, or a real sign-in visit before `next` sent them on).

/** Whether `router.back()` is safe, given the document's actual referrer and current origin. */
export function shouldGoBack(referrer: string, currentOrigin: string): boolean {
  if (!referrer) return false;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return false;
  }
  if (url.origin !== currentOrigin) return false;
  return !isAuthPagePath(url.pathname);
}
