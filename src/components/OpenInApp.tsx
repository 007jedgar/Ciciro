"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";

/** How long the page waits to be backgrounded by the app before deciding it is not installed. */
export const APP_LAUNCH_WAIT_MS = 1500;

// The writing workspace is a desktop layout. Below 700px wide (see
// .open-in-app in globals.css and WorkspaceGate) it is not shown and this
// screen sends the writer to the native app instead.
export default function OpenInApp({ title }: { title: string }) {
  const [notInstalled, setNotInstalled] = useState(false);
  const stopWaiting = useRef<(() => void) | null>(null);

  useEffect(() => () => stopWaiting.current?.(), []);

  function waitForAppLaunch() {
    stopWaiting.current?.();
    setNotInstalled(false);
    const left = () => stopWaiting.current?.();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") left();
    };
    const timer = window.setTimeout(() => {
      stopWaiting.current?.();
      setNotInstalled(true);
    }, APP_LAUNCH_WAIT_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", left);
    window.addEventListener("blur", left);
    stopWaiting.current = () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", left);
      window.removeEventListener("blur", left);
      stopWaiting.current = null;
    };
  }

  return (
    <main className="open-in-app" aria-labelledby="open-in-app-title">
      <BrandMark />
      <h1 id="open-in-app-title">Open {title} in the app</h1>
      <p>
        The writing workspace needs a wider screen. The Ciciro app has the editor, your chapters
        and Ciciro, made for the small screen.
      </p>
      <a className="btn primary" href="ciciro://" onClick={waitForAppLaunch}>
        Open in the app
      </a>
      {notInstalled && <p role="status">The Ciciro app is not installed on this device.</p>}
      <Link href="/" className="btn ghost">
        Back to manuscripts
      </Link>
    </main>
  );
}
