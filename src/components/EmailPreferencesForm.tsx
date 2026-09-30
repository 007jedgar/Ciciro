"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AuthPanel from "@/components/AuthPanel";
import { EMAIL_TOPICS, TOPIC_LABELS, type EmailTopic } from "@/lib/email/topics";

type Prefs = { marketingOptIn: boolean } & Record<EmailTopic, boolean>;

async function load(token: string): Promise<Prefs | null> {
  const res = await fetch(`/api/email/preferences?t=${encodeURIComponent(token)}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

async function save(token: string, patch: Partial<Prefs>): Promise<Prefs | null> {
  const res = await fetch(`/api/email/preferences?t=${encodeURIComponent(token)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return null;
  return res.json();
}

/** The one-click POST every marketing email's List-Unsubscribe header targets. */
async function confirmUnsubscribe(token: string, topic: EmailTopic): Promise<void> {
  await fetch(`/api/email/unsubscribe?t=${encodeURIComponent(token)}&topic=${topic}`, { method: "POST" });
}

export default function EmailPreferencesForm() {
  const params = useSearchParams();
  const token = params.get("t") ?? "";
  const justUnsubscribed = params.get("unsubscribed");
  const confirmTopic = params.get("confirm") as EmailTopic | null;
  const [prefs, setPrefs] = useState<Prefs | "invalid" | "loading">("loading");
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!token) {
      setPrefs("invalid");
      return;
    }
    load(token).then((data) => setPrefs(data ?? "invalid"));
  }, [token]);

  async function toggle(topic: EmailTopic, value: boolean) {
    if (!prefs || prefs === "invalid" || prefs === "loading") return;
    setPrefs({ ...prefs, [topic]: value });
    setSaving(true);
    const next = await save(token, { [topic]: value });
    if (next) setPrefs(next);
    setSaving(false);
  }

  async function unsubscribeFromAll() {
    setSaving(true);
    const next = await save(token, { marketingOptIn: false });
    if (next) setPrefs(next);
    setSaving(false);
  }

  async function confirmClick(topic: EmailTopic) {
    setSaving(true);
    await confirmUnsubscribe(token, topic);
    const next = await load(token);
    if (next) setPrefs(next);
    setConfirmed(true);
    setSaving(false);
  }

  if (prefs === "loading") {
    return (
      <AuthPanel title="Email preferences">
        <p className="auth-lede">Loading…</p>
      </AuthPanel>
    );
  }

  if (prefs === "invalid") {
    return (
      <AuthPanel title="Email preferences">
        <p className="auth-lede">
          This link is no longer valid. If you want to change what Ciciro emails you, sign in and
          open Settings instead.
        </p>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel title="Email preferences">
      {justUnsubscribed && (
        <p className="auth-lede" role="status">
          You&apos;re unsubscribed from {TOPIC_LABELS[justUnsubscribed as EmailTopic]?.title ?? "that email"}.
        </p>
      )}
      {confirmTopic && TOPIC_LABELS[confirmTopic] && prefs.marketingOptIn && prefs[confirmTopic] && !confirmed && (
        <p className="auth-lede" role="alert">
          Unsubscribe from {TOPIC_LABELS[confirmTopic].title}?{" "}
          <button
            type="button"
            className="auth-link-button"
            onClick={() => confirmClick(confirmTopic)}
            disabled={saving}
          >
            Yes, unsubscribe
          </button>
        </p>
      )}
      {confirmTopic && confirmed && (
        <p className="auth-lede" role="status">
          You&apos;re unsubscribed from {TOPIC_LABELS[confirmTopic]?.title ?? "that email"}.
        </p>
      )}
      {!prefs.marketingOptIn ? (
        <p className="auth-lede">
          You&apos;re unsubscribed from marketing email. Ciciro still sends the email your account
          needs, like sign-in and billing notices.
        </p>
      ) : (
        <>
          <p className="auth-lede">Choose what Ciciro emails you.</p>
          <div className="email-prefs-topics">
            {EMAIL_TOPICS.map((topic) => (
              <label key={topic} className="email-prefs-topic">
                <input
                  type="checkbox"
                  checked={prefs[topic]}
                  disabled={saving}
                  onChange={(e) => toggle(topic, e.target.checked)}
                />
                <span>
                  <strong>{TOPIC_LABELS[topic].title}</strong>
                  <br />
                  {TOPIC_LABELS[topic].description}
                </span>
              </label>
            ))}
          </div>
          <button type="button" className="auth-link-button" onClick={unsubscribeFromAll} disabled={saving}>
            Unsubscribe from all marketing email
          </button>
        </>
      )}
    </AuthPanel>
  );
}
