# landing-video

Renders the home page's "reminder arrives → tap → manuscript opens" phone
clip (`public/landing/phone-reminder-{day,night}.{mp4,webm,webp}`), read by
`PhoneClip`/`copy.ts` in `src/components/landing/`. This is a coded
animation (React + [Remotion](https://www.remotion.dev)), not an AI-generated
video, built on the real Ciciro paper/ink palette, Newsreader/Instrument
Sans fonts, and a generic iPhone frame with no other apps or personal
content. This directory is a standalone package (its own `node_modules`,
excluded from the Next.js app's typecheck/lint/test/build — see the root
`tsconfig.json`, `eslint.config.mjs`, and `vitest.config.mjs` exclude lists)
and is not part of the app bundle.

## Re-rendering

```sh
cd tools/landing-video
npm install
npm run render
```

This renders both theme variants and writes them straight into
`public/landing/`, overwriting the existing `phone-reminder-{day,night}.*`
files. Commit the result normally from the repo root.

## Previewing while editing

```sh
npm run studio
```

Opens the Remotion Studio for the `reminder-day` / `reminder-night`
compositions (`src/Root.tsx`) with live reload. Use `npx remotion still
reminder-day out/preview.png --frame=<n>` to spot-check a single frame
without a full render.

## Structure

- `src/ReminderToWrite.tsx` — the composition and its frame-by-frame
  timeline (lock screen → notification slides in → tap → manuscript editor
  → fades back to the loop point).
- `src/components/` — `PhoneFrame` (generic bezel + Dynamic Island),
  `LockScreen`, `NotificationBanner`, `ManuscriptEditor`, `BrandMark`.
- `src/theme.ts` — day/night palette, mirroring the `--bg`/`--panel`/`--ink`/
  `--vermilion` tokens in `src/app/globals.css`.
- `src/copy.ts` — the notification title/excerpt, the same strings the
  landing page already uses as its canonical example reminder (see `SCENE`
  in `src/components/landing/copy.ts`).
- `src/fonts.ts` — loads Newsreader and Instrument Sans via
  `@remotion/google-fonts`.
- `scripts/render-all.mjs` — the `npm run render` entry point.

## Changing the dimensions or loop length

`src/Root.tsx`'s `WIDTH`/`HEIGHT`/`DURATION_IN_FRAMES` must match what
`PhoneClip` expects (currently 600×1304, matching the clip it replaced).
If you resize, update the `width`/`height` on the two clip entries in
`src/components/landing/copy.ts` too.
