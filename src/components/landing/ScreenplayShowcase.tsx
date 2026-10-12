import { SCREENPLAY_SHOWCASE } from "./copy";

/**
 * A real page of screenplay, set with the editor's own CSS
 * (.ProseMirror.screenplay in globals.css, which mirrors ELEMENT_METRICS in
 * src/lib/screenplay.ts), not a screenshot: same font, same uppercase
 * cues, same parens around a parenthetical. --screenplay-size is sized by
 * container query width (landing-script-page), the CSS equivalent of the
 * editor's own ResizeObserver, so the 60-column page fits a phone without
 * scrolling instead of being cropped.
 */
export default function ScreenplayShowcase() {
  return (
    <figure className="landing-exhibit landing-script-exhibit">
      <div className="landing-window landing-script-window">
        <div className="landing-window-bar" aria-hidden>
          <i />
          <i />
          <i />
          <span>ciciro.app</span>
        </div>
        <div className="landing-script-page">
          <div className="landing-script-inner">
            <div className="ProseMirror screenplay" aria-hidden>
              {SCREENPLAY_SHOWCASE.lines.map((line, i) => (
                <p key={i} data-sp={line.tag === "action" ? undefined : line.tag}>
                  {line.text}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
      <figcaption>
        <span className="landing-exhibit-label">Exhibit G / Web app, Screenplay mode (Beta)</span>
        {SCREENPLAY_SHOWCASE.caption}
      </figcaption>
    </figure>
  );
}
