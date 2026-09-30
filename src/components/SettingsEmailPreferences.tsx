"use client";

import { useEffect, useState } from "react";
import { EMAIL_TOPICS, TOPIC_LABELS, type EmailTopic } from "@/lib/email/topics";

type Prefs = { marketingOptIn: boolean } & Record<EmailTopic, boolean>;

async function load(): Promise<Prefs | null> {
  const res = await fetch("/api/account/email-preferences", { cache: "no-store", credentials: "include" });
  if (!res.ok) return null;
  return res.json();
}

async function save(patch: Partial<Prefs>): Promise<Prefs | null> {
  const res = await fetch("/api/account/email-preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(patch),
  });
  if (!res.ok) return null;
  return res.json();
}

/** The Settings popover's email section: the marketing checkbox and, once
 *  it's on, the topics it unlocks. */
export default function SettingsEmailPreferences() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load().then(setPrefs);
  }, []);

  async function toggleMarketing(value: boolean) {
    if (!prefs) return;
    setPrefs({ ...prefs, marketingOptIn: value });
    setBusy(true);
    const next = await save({ marketingOptIn: value });
    if (next) setPrefs(next);
    setBusy(false);
  }

  async function toggleTopic(topic: EmailTopic, value: boolean) {
    if (!prefs) return;
    setPrefs({ ...prefs, [topic]: value });
    setBusy(true);
    const next = await save({ [topic]: value });
    if (next) setPrefs(next);
    setBusy(false);
  }

  if (!prefs) return null;

  return (
    <>
      <div className="theme-menu-label">Email</div>
      <label className="settings-row settings-toggle-row">
        <span>Marketing email</span>
        <input
          type="checkbox"
          checked={prefs.marketingOptIn}
          disabled={busy}
          onChange={(e) => toggleMarketing(e.target.checked)}
        />
      </label>
      {prefs.marketingOptIn &&
        EMAIL_TOPICS.map((topic) => (
          <label key={topic} className="settings-row settings-toggle-row settings-subrow">
            <span>{TOPIC_LABELS[topic].title}</span>
            <input
              type="checkbox"
              checked={prefs[topic]}
              disabled={busy}
              onChange={(e) => toggleTopic(topic, e.target.checked)}
            />
          </label>
        ))}
    </>
  );
}
