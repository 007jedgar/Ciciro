"use client";

import { useEffect, useState } from "react";

type Template = { id: string; title: string; group: string; subject: string; preview: string };
type View = "light" | "dark" | "text";

const VIEWS: { id: View; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "text", label: "Plain text" },
];

function readHash(templates: Template[]): { id: string; view: View } {
  const [id, view] = window.location.hash.slice(1).split("/");
  return {
    id: templates.some((t) => t.id === id) ? id : templates[0].id,
    view: VIEWS.some((v) => v.id === view) ? (view as View) : "light",
  };
}

export default function EmailGallery({ templates }: { templates: Template[] }) {
  const [selected, setSelected] = useState({ id: templates[0].id, view: "light" as View });

  // The hash keeps a view linkable (/dev/emails#welcome/dark).
  useEffect(() => {
    setSelected(readHash(templates));
    const onHash = () => setSelected(readHash(templates));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [templates]);

  const current = templates.find((t) => t.id === selected.id) ?? templates[0];
  const src = `/dev/emails/${current.id}${selected.view === "text" ? "?format=text" : ""}`;
  const groups = [...new Set(templates.map((t) => t.group))];

  return (
    <div className="email-gallery">
      <nav className="email-gallery-nav" aria-label="Email templates">
        <p className="email-gallery-eyebrow">Email previews</p>
        {groups.map((group) => (
          <div key={group} className="email-gallery-group">
            <p className="email-gallery-group-label">{group}</p>
            {templates
              .filter((t) => t.group === group)
              .map((t) => (
                <a
                  key={t.id}
                  href={`#${t.id}/${selected.view}`}
                  className="email-gallery-link"
                  aria-current={t.id === current.id ? "page" : undefined}
                >
                  {t.title}
                </a>
              ))}
          </div>
        ))}
      </nav>
      <main className="email-gallery-main">
        <header className="email-gallery-head">
          <div className="email-gallery-meta">
            <p className="email-gallery-subject">{current.subject}</p>
            <p className="email-gallery-preview">{current.preview}</p>
          </div>
          <div className="email-gallery-views" role="group" aria-label="View">
            {VIEWS.map((v) => (
              <a
                key={v.id}
                href={`#${current.id}/${v.id}`}
                className="email-gallery-view"
                aria-current={v.id === selected.view ? "true" : undefined}
              >
                {v.label}
              </a>
            ))}
          </div>
        </header>
        {/* An iframe's prefers-color-scheme follows its own color-scheme, so the
            email's dark-mode CSS runs exactly as in a dark mail client. */}
        <iframe
          key={`${current.id}-${selected.view}`}
          className={`email-gallery-frame ${selected.view}`}
          title={`${current.title} (${selected.view})`}
          src={src}
          style={{ colorScheme: selected.view === "dark" ? "dark" : "light" }}
        />
        <p className="email-gallery-raw">
          Raw: <a href={`/dev/emails/${current.id}`}>HTML</a> · <a href={`/dev/emails/${current.id}?format=text`}>text</a>
        </p>
      </main>
    </div>
  );
}
