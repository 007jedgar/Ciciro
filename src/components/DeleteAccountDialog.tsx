"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import Presence from "@/components/Presence";
import { MOTION_MS } from "@/lib/motion";
import { SETTINGS_SYNC_EVENT } from "@/lib/settings";
import { DELETED_WITH_ACCOUNT, EXPORT_URL } from "@/lib/account/copy";

/**
 * The destructive confirmation for deleting an account: says what goes,
 * offers the export first, and needs the password before it will act.
 */
export default function DeleteAccountDialog({
  open,
  email,
  onClose,
}: {
  open: boolean;
  email: string;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setError(null);
    setBusy(false);
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Claim the key so focus mode, which listens on window, does not also exit.
      e.stopPropagation();
      onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/account", {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Could not delete your account. Try again.");
        setBusy(false);
        return;
      }
      window.dispatchEvent(new Event(SETTINGS_SYNC_EVENT));
      // A full navigation drops every bit of the deleted account's client state.
      window.location.assign("/account/delete?deleted=1");
    } catch {
      setError("Could not reach Ciciro. Check your connection and try again.");
      setBusy(false);
    }
  }

  // Portaled so a transformed or filtered ancestor (the top bar) cannot trap
  // the fixed overlay inside its own box.
  if (typeof document === "undefined") return null;
  return createPortal(
    <Presence open={open} exitMs={MOTION_MS.dialogOut}>
      <div className="drawer-overlay" onClick={busy ? undefined : onClose} />
      <form
        className="account-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        aria-describedby="delete-account-body"
        onSubmit={submit}
      >
        <h2 id="delete-account-title">Delete your account?</h2>
        <div id="delete-account-body">
          <p>
            This permanently deletes <strong>{email}</strong> and everything in it:
          </p>
          <ul>
            {DELETED_WITH_ACCOUNT.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="account-dialog-warning">
            This can&apos;t be undone. Nothing can be recovered afterwards, and every device signed in
            to this account is signed out.
          </p>
        </div>
        <div className="account-dialog-export">
          <span>Want a copy first?</span>
          <a className="btn small" href={EXPORT_URL} download>
            Export my data
          </a>
        </div>
        <label className="account-dialog-field">
          <span>Enter your password to confirm</span>
          <input
            ref={inputRef}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>
        {error ? (
          <p className="account-dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="account-dialog-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn danger" disabled={!password || busy}>
            {busy ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </form>
    </Presence>,
    document.body
  );
}
