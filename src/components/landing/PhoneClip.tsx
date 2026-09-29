"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/lib/motion";
import type { Clip } from "./copy";

/**
 * A phone recording in a device frame. Day and night each have a poster and a
 * clip; CSS on the root's data-mode shows one, and only that one ever loads
 * or plays: once it is on screen, never with motion reduced (the poster stays),
 * and it pauses again when scrolled away or the tab is hidden.
 */
export default function PhoneClip({ clip }: { clip: Clip }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const videos = [...root.querySelectorAll("video")];
    let inView = false;

    const sync = () => {
      const still = !inView || document.hidden || prefersReducedMotion();
      for (const video of videos) {
        // The variant for the other mode is display: none.
        const shown = video.offsetParent !== null;
        if (!still && shown) {
          video.play().catch(() => {});
        } else if (!video.paused) {
          video.pause();
        }
      }
    };

    const seen = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        sync();
      },
      { threshold: 0.35 }
    );
    seen.observe(root);
    const mode = new MutationObserver(sync);
    mode.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode", "data-reduce-motion"] });
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener("change", sync);
    return () => {
      seen.disconnect();
      mode.disconnect();
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", sync);
    };
  }, []);

  return (
    <div className="landing-phone-clip" ref={host} style={{ aspectRatio: `${clip.width} / ${clip.height}` }}>
      {(["day", "night"] as const).map((mode) => (
        <div key={mode} className={`landing-media-${mode}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- prebuilt WebP; the Worker has no image optimizer */}
          <img
            src={clip[mode].poster}
            alt={clip.alt}
            width={clip.width}
            height={clip.height}
            loading="lazy"
            decoding="async"
          />
          <video
            width={clip.width}
            height={clip.height}
            muted
            loop
            playsInline
            preload="none"
            aria-hidden
            tabIndex={-1}
            onPlaying={(event) => event.currentTarget.setAttribute("data-playing", "")}
          >
            <source src={clip[mode].webm} type="video/webm" />
            <source src={clip[mode].mp4} type="video/mp4" />
          </video>
        </div>
      ))}
    </div>
  );
}
