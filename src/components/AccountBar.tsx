"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Me = { id: string; email: string; name: string } | null;

export default function AccountBar() {
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (active) setMe(d.user ?? null);
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
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setMe(null);
    router.refresh();
    router.push("/login");
  }

  if (!loaded) return null;

  return (
    <div className="account-bar">
      {me ? (
        <>
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
