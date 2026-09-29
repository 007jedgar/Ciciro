import { useEffect } from "react";
import { useRouter } from "expo-router";

/**
 * ciciro://oauth is where a browser sign-in returns. On iOS the auth session
 * hands that URL straight to expo-web-browser; on Android it also arrives as a
 * deep link, and the router would otherwise show "unmatched route". The
 * sign-in itself finishes in the screen that started it, so just step back.
 */
export default function OAuthReturn() {
  const router = useRouter();
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);
  return null;
}
