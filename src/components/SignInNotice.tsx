"use client";

import { useEffect } from "react";
import { useSnackbar } from "@/components/Snackbar";

const PARAM = "password_removed";
const NAMES: Record<string, string> = { apple: "Apple", google: "Google" };

/**
 * The one-time notice after a provider sign-in claimed an unverified password
 * account (`?password_removed=google` on the landing URL). Shown once: the
 * parameter is dropped from the address bar as it is read.
 */
export default function SignInNotice() {
  const show = useSnackbar();
  useEffect(() => {
    const url = new URL(window.location.href);
    const provider = NAMES[url.searchParams.get(PARAM) ?? ""];
    if (!provider) return;
    url.searchParams.delete(PARAM);
    window.history.replaceState(window.history.state, "", url);
    show({
      message: `For your security, this account now signs in with ${provider}; your old password was removed.`,
      duration: 12000,
    });
  }, [show]);
  return null;
}
