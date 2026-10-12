import { EXERCISE } from "./copy";

type Panel = { label: string; prompt: string; sample?: string };

/**
 * A loop of the guided writing exercise: four senses to settle into, then
 * three short prompts (Observe, React, Narrate), each panel fading in for its
 * turn and the sample line typing itself in, same shape as PhoneClip's
 * day/night loop. No JS: one set of keyframes, each panel offset by a
 * negative animation-delay (--xd) so they take their turn in order and never
 * drift out of sync. Decorative; the body text above carries the meaning.
 */
export default function ExerciseDemo() {
  const panels: Panel[] = [
    ...EXERCISE.settle.map((s) => ({ label: s.label, prompt: s.prompt })),
    ...EXERCISE.parts.map((p) => ({ label: p.label, prompt: p.prompt, sample: p.sample })),
  ];

  return (
    <figure className="landing-exhibit landing-exercise-exhibit">
      <div className="landing-exercise-card" aria-hidden>
        {panels.map((panel, i) => (
          <div
            key={panel.label}
            className="landing-exercise-panel"
            style={{ "--xd": `calc(${-i} * var(--duration-exercise-stage))` } as React.CSSProperties}
          >
            <span className="landing-exercise-kicker">{panel.label}</span>
            <p className="landing-exercise-prompt">{panel.prompt}</p>
            {panel.sample ? (
              <p className="landing-exercise-sample">
                <span className="landing-exercise-type">{panel.sample}</span>
                <span className="landing-caret" />
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <figcaption>
        <span className="landing-exhibit-label">Exhibit F / Guided exercise</span>
        {EXERCISE.caption}
      </figcaption>
    </figure>
  );
}
