"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SETTINGS_SYNC_EVENT } from "@/lib/settings";
import type { Entitlement } from "@/lib/billing-client";
import { getAnalytics } from "@/lib/analytics-client";
import { signOutAnalytics } from "@/components/AnalyticsProvider";

type Me = { id: string; email: string; name: string } | null;

export default function AccountBar() {
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        setMe(d.user ?? null);
        setEntitlement(d.entitlement ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function signOut() {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    }).catch(() => {});
    getAnalytics().track("signed_out", {});
    signOutAnalytics();
    setMe(null);
    window.dispatchEvent(new Event(SETTINGS_SYNC_EVENT));
    router.refresh();
    router.push("/login");
  }

  if (!loaded) return null;

  return (
    <div className="account-bar">
      {me ? (
        <>
          {entitlement?.plan === "free" && entitlement.billing.web ? (
            <Link className="account-upgrade" href="/pricing">
              Upgrade
            </Link>
          ) : null}
          <span className="account-email" title={me.email}>
            {me.name || me.email}
          </span>
          <button className="btn ghost small" onClick={signOut} type="button">
            Sign out
          </button>
        </>
      ) : (
        <Link className="btn ghost small" href="/login">
          Sign in
        </Link>
      )}
    </div>
  );
}
