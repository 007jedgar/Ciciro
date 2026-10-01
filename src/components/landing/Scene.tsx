"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { SCENE, SCENE_TABS, type SceneShot } from "./copy";

type TabKey = "chapters" | "characters" | "outline";

const TAB_ORDER: TabKey[] = ["chapters", "characters", "outline"];
const TAB_COLOR: Record<TabKey, string> = { chapters: "v", characters: "b", outline: "y" };

/** The desk-to-phone handoff: a punched manuscript sheet in a cobalt folder,
    the phone that picks the sentence up, and the nudge that brought you back.
    The three binder tabs are real tabs: each swaps the sheet for a screenshot
    of that screen from the real app, in the same world as the chapter (Mara,
    the letter, the harbour). The phone shows that tab's mobile screenshot, or
    the typing animation when the tab has none (Chapters). The receipt, clip
    and stamp stay put, and every screenshot sits in a fixed-size slot, so the
    folder never changes size when you switch. */
export default function Scene() {
  const [active, setActive] = useState<TabKey>("chapters");
  const [cycle, setCycle] = useState(0);
  const baseId = useId();

  const select = (key: TabKey) => {
    if (key === active) return;
    if (key === "chapters") setCycle((n) => n + 1);
    setActive(key);
  };

  const focusTab = (key: TabKey) => {
    document.getElementById(`${baseId}-tab-${key}`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % TAB_ORDER.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      nextIndex = (index - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = TAB_ORDER.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = TAB_ORDER[nextIndex];
    select(next);
    focusTab(next);
  };

  return (
    <div className="landing-folder">
      <div className="landing-tabs" role="tablist" aria-label="Preview the chapters, characters and outline">
        {TAB_ORDER.map((key, index) => (
          <button
            key={key}
            id={`${baseId}-tab-${key}`}
            type="button"
            role="tab"
            className={`landing-tab landing-tab-${TAB_COLOR[key]}${active === key ? " is-active" : ""}`}
            aria-selected={active === key}
            aria-controls={`${baseId}-panel`}
            tabIndex={active === key ? 0 : -1}
            onClick={() => select(key)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {SCENE_TABS[key].label}
          </button>
        ))}
      </div>
      <div className="landing-scene">
        <div
          className="landing-sheet"
          id={`${baseId}-panel`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${active}`}
          tabIndex={0}
        >
          <div className="landing-holes" aria-hidden>
            <i />
            <i />
            <i />
          </div>
          <SheetPanel active={active} key={active} />
        </div>
        <div className="landing-phone" aria-hidden>
          {SCENE_TABS[active].phone ? (
            <PhoneShot shot={SCENE_TABS[active].phone as SceneShot} />
          ) : (
            <div className="landing-screen" key={cycle}>
              <div className="landing-screen-meta">
                <span>Thursday</span>
                <span>9:41</span>
              </div>
              <div className="landing-reminder">
                <span className="landing-reminder-app">
                  <span className="landing-reminder-icon">
                    <i />
                    <i />
                    <i />
                  </span>
                  Ciciro
                </span>
                <b>{SCENE.reminderTitle}</b>
                <span>{SCENE.reminderBody}</span>
                <span className="landing-reminder-nudge">{SCENE.reminderNudge}</span>
              </div>
              <p>
                ...only to feel the{" "}
                <span className="landing-type-in">weight of it, warm from her pocket.</span>
                <span className="landing-caret landing-caret-phone" />
              </p>
            </div>
          )}
        </div>
        <div className="landing-receipt" aria-hidden>
          <span className="landing-receipt-big">THIS WEEK</span>
          Aiming for 4 days.
          <br />
          Rest days are part of it.
          <span className="landing-receipt-row">
            <span>LAST 7 DAYS</span>
            <span>3 WRITTEN</span>
          </span>
          <span className="landing-receipt-row">
            <span>STREAK</span>
            <span>NONE KEPT</span>
          </span>
        </div>
        <svg className="landing-clip" viewBox="0 0 20 56" aria-hidden>
          <path d="M6 44 V10 a4 4 0 0 1 8 0 V48 a6 6 0 0 1 -12 0 V14" />
        </svg>
        <svg className="landing-stamp" viewBox="0 0 120 120" aria-hidden>
          <circle cx="60" cy="60" r="56" strokeWidth="3" />
          <circle cx="60" cy="60" r="40" strokeWidth="1.5" />
          <defs>
            <path id="landing-stamp-ring" d="M60 60 m-48 0 a48 48 0 1 1 96 0 a48 48 0 1 1 -96 0" />
          </defs>
          <text>
            <textPath href="#landing-stamp-ring">COUNTED · CICIRO · COUNTED · CICIRO ·</textPath>
          </text>
          <text x="60" y="66" textAnchor="middle" className="landing-stamp-center">
            5 MIN
          </text>
        </svg>
      </div>
    </div>
  );
}

/** One screenshot, day and night, cropped from the real app. CSS on the
    root's data-mode shows one and leaves the other display: none, unloaded. */
function Shot({ shot, className }: { shot: SceneShot; className?: string }) {
  return (
    <>
      {(["day", "night"] as const).map((mode) => (
        <picture key={mode} className={`landing-media-${mode}`}>
          <img
            className={className}
            src={shot[mode]}
            alt={shot.alt}
            width={shot.width}
            height={shot.height}
            loading="lazy"
            decoding="async"
          />
        </picture>
      ))}
    </>
  );
}

function PhoneShot({ shot }: { shot: SceneShot }) {
  return (
    <div className="landing-screen landing-screen-shot">
      <Shot shot={shot} />
    </div>
  );
}

/** The sheet for the active tab: a real screenshot, pinned under the file's
    title and tag, with the same "last kept" ledger line every tab shares. */
function SheetPanel({ active }: { active: TabKey }) {
  const data = SCENE_TABS[active];
  return (
    <>
      <div className="landing-sheet-head">
        <span className="landing-sheet-title">{data.title}</span>
        <span className="landing-file-no">{data.tag}</span>
      </div>
      <div
        className="landing-sheet-shot"
        style={{ "--shot-ratio": `${data.sheet.width} / ${data.sheet.height}` } as React.CSSProperties}
      >
        <Shot shot={data.sheet} />
      </div>
      <div className="landing-sheet-foot">
        <span>Last kept: desk, 9:12 pm</span>
        <span>{data.footNote}</span>
      </div>
    </>
  );
}
