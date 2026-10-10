"use client";

import { useState } from "react";
import BetaBadge from "@/components/BetaBadge";
import { hasKindSettings, type ManuscriptKind } from "@/lib/manuscript-kind";
import {
  SCREENPLAY_ELEMENT_LABELS,
  TITLE_PAGE_LIMITS,
  resolveTitlePage,
  type ScriptSettings,
  type TitlePage,
} from "@/lib/screenplay";
import { screenplayShortcuts } from "@/lib/screenplay-view";
import { isMacPlatform } from "@/lib/selection-menu-view";

/** The open script's own settings: what they are, who it is by, and how to write a change back. */
export type ScriptSettingsControl = {
  settings: ScriptSettings;
  /** The manuscript's own title and author, which a blank title page falls back on. */
  manuscript: { title: string; author: string };
  onChange: (next: ScriptSettings) => void;
};

/**
 * Settings that belong to the manuscript that is open, for its kind, at the top
 * of the Settings menu. Nothing shows for a kind with none, or outside a
 * manuscript (the library).
 */
export default function ManuscriptSettings({
  kind,
  script,
}: {
  kind?: ManuscriptKind;
  script?: ScriptSettingsControl;
}) {
  if (!kind || !hasKindSettings(kind)) return null;
  switch (kind) {
    case "screenplay":
      return <ScreenplaySettings script={script} />;
    default:
      return null;
  }
}

function Switch({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`settings-switch ${on ? "on" : ""}`}
        onClick={() => onChange(!on)}
      >
        {on ? "On" : "Off"}
      </button>
    </div>
  );
}

const TITLE_FIELDS: { field: keyof TitlePage; label: string; placeholder: (s: ScriptSettingsControl) => string; multiline?: boolean }[] = [
  { field: "title", label: "Title", placeholder: (s) => resolveTitlePage(s.settings.titlePage, s.manuscript).title },
  { field: "credit", label: "Credit", placeholder: () => "Written by" },
  { field: "author", label: "Author", placeholder: (s) => s.manuscript.author },
  { field: "source", label: "Source", placeholder: () => "Based on…" },
  { field: "draftDate", label: "Draft date", placeholder: () => "" },
  { field: "contact", label: "Contact", placeholder: () => "Name, address, email, phone", multiline: true },
];

function TitlePageFields({ script }: { script: ScriptSettingsControl }) {
  // Typing lives here; the stored copy is tidied (spaces trimmed) and would fight a controlled field.
  const [page, setPage] = useState<TitlePage>(script.settings.titlePage);
  const [shown, setShown] = useState(script.settings.showTitlePage);
  return (
    <details className="settings-shortcuts title-page-settings">
      <summary>Title page</summary>
      <div className="settings-row">
        <span>Title page in the PDF</span>
        <button
          type="button"
          role="switch"
          aria-checked={shown}
          aria-label="Title page in the PDF"
          className={`settings-switch ${shown ? "on" : ""}`}
          onClick={() => {
            setShown(!shown);
            script.onChange({ ...script.settings, titlePage: page, showTitlePage: !shown });
          }}
        >
          {shown ? "On" : "Off"}
        </button>
      </div>
      {TITLE_FIELDS.map(({ field, label, placeholder, multiline }) => {
        const id = `title-page-${field}`;
        const limit = TITLE_PAGE_LIMITS[field];
        const change = (value: string) => {
          const next = { ...page, [field]: value };
          setPage(next);
          script.onChange({ ...script.settings, titlePage: next, showTitlePage: shown });
        };
        return (
          <label key={field} className="title-page-field" htmlFor={id}>
            <span>{label}</span>
            {multiline ? (
              <textarea
                id={id}
                rows={3}
                maxLength={limit}
                value={page[field]}
                placeholder={placeholder(script)}
                onChange={(e) => change(e.target.value)}
              />
            ) : (
              <input
                id={id}
                type="text"
                maxLength={limit}
                value={page[field]}
                placeholder={placeholder(script)}
                onChange={(e) => change(e.target.value)}
              />
            )}
          </label>
        );
      })}
      <p className="settings-hint">
        The title page is the first page of the screenplay PDF and the first lines of a Fountain or FDX export. A blank
        title or author is the manuscript&rsquo;s own. It is not counted in the script&rsquo;s pages.
      </p>
    </details>
  );
}

function ScreenplaySettings({ script }: { script?: ScriptSettingsControl }) {
  const mac = isMacPlatform(typeof navigator === "undefined" ? undefined : navigator.platform);
  return (
    <section className="kind-settings" aria-label="Screenplay settings">
      <div className="theme-menu-label">
        This screenplay <BetaBadge />
      </div>
      <div className="settings-row">
        <span>Script type</span>
        <span className="settings-locked" title="Locked for a script">
          12 pt Courier Prime
        </span>
      </div>
      <p className="settings-hint">
        Scripts are set in 12 pt Courier Prime on a 60 column page, so a page here is a page on paper. The Type and
        Size settings below do not apply to them.
      </p>
      {script ? (
        <>
          <Switch
            label="(MORE) at the foot of a page"
            on={script.settings.more}
            onChange={(more) => script.onChange({ ...script.settings, more })}
          />
          <Switch
            label="(CONT'D) on the next page"
            on={script.settings.contd}
            onChange={(contd) => script.onChange({ ...script.settings, contd })}
          />
          <p className="settings-hint">
            When a speech runs past the end of a page, it ends the page with (MORE) and the next page opens with the
            cue and (CONT&rsquo;D). Each takes a line of the page, so turning one off can move where pages end.
          </p>
          <Switch
            label="Scene numbers"
            on={script.settings.sceneNumbers}
            onChange={(sceneNumbers) => script.onChange({ ...script.settings, sceneNumbers })}
          />
          <p className="settings-hint">
            Numbers each scene heading in both margins of the PDF and as #1# in Fountain. For a locked draft, not a
            spec script.
          </p>
          <TitlePageFields script={script} />
        </>
      ) : null}
      <details className="settings-shortcuts">
        <summary>Element shortcuts</summary>
        <dl>
          {screenplayShortcuts(mac, SCREENPLAY_ELEMENT_LABELS).map((row) => (
            <div key={row.keys}>
              <dt>
                <kbd>{row.keys}</kbd>
              </dt>
              <dd>{row.label}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
