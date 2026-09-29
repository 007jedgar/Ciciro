import type { Exhibit as ExhibitData, Still } from "./copy";
import PhoneClip from "./PhoneClip";

/* Screenshots of the real apps are prebuilt WebP files in public/landing, in
   a day and a night version; CSS on the root's data-mode shows one, and the
   other, display: none and lazy, never loads. */

const NARROW = "(max-width: 640px)";

function StillMedia({ still }: { still: Still }) {
  const { narrow } = still;
  const ratio = {
    "--exhibit-ratio": `${still.width} / ${still.height}`,
    "--exhibit-ratio-narrow": narrow ? `${narrow.width} / ${narrow.height}` : undefined,
  } as React.CSSProperties;
  return (
    <div className="landing-exhibit-media" style={ratio}>
      {(["day", "night"] as const).map((mode) => (
        <picture key={mode} className={`landing-media-${mode}`}>
          {narrow ? (
            <source media={NARROW} srcSet={narrow[mode]} width={narrow.width} height={narrow.height} />
          ) : null}
          <img
            src={still[mode]}
            alt={still.alt}
            width={still.width}
            height={still.height}
            loading="lazy"
            decoding="async"
          />
        </picture>
      ))}
    </div>
  );
}

export default function Exhibit({ exhibit }: { exhibit: ExhibitData }) {
  const { media } = exhibit;
  const frame = media.kind === "phones" ? "phones" : media.frame;
  return (
    <figure className={`landing-exhibit landing-exhibit-${frame}`}>
      {media.kind === "phones" ? (
        <div className="landing-phones">
          {media.clips.map((clip) => (
            <PhoneClip key={clip.day.mp4} clip={clip} />
          ))}
        </div>
      ) : media.frame === "window" ? (
        <div className="landing-window">
          <div className="landing-window-bar" aria-hidden>
            <i />
            <i />
            <i />
            <span>ciciro.app</span>
          </div>
          <StillMedia still={media} />
        </div>
      ) : (
        <div className="landing-cutout">
          <StillMedia still={media} />
        </div>
      )}
      <figcaption>
        <span className="landing-exhibit-label">{exhibit.label}</span>
        {exhibit.caption}
      </figcaption>
    </figure>
  );
}
