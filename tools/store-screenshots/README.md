# store-screenshots

Renders Ciciro's App Store and Google Play screenshots, and the Play feature
graphic, from real captures of the app. A standalone package (its own
`node_modules`, excluded from the Next.js app's typecheck, like
`tools/landing-video`), not part of any bundle.

Each frame is an HTML/CSS composition drawn on a 1000px-wide canvas and
rasterised by headless Chrome at the store's exact pixel size, so one design
serves every target and every locale. The look is the homepage's: Newsreader
display type with one italic word, JetBrains Mono tabs, Instrument Sans body,
and the Archive paper stocks (ink, blue, vermilion, butter, blush, paper).
Frames that show the app use captures taken from the app itself, never mocks.

```sh
cd tools/store-screenshots
npm install
npm run render                          # every target, English
node src/render.mjs --targets ios-iphone-6.9 --frames hero,reminders
node src/render.mjs --check             # list missing captures, render nothing
node src/render.mjs --placeholders      # layout check with grey stand-ins -> out/_placeholder/ (never ships)
```

Output goes to `out/<locale>/<target>/NN-<frame>.png` (git-ignored; rebuild
with the command above). It needs Chrome: `CHROME_PATH=/path/to/chrome` if it
is not at the macOS default.

## What the stores ask for

Checked against Apple's "Screenshot specifications" and Google Play Console
help on 2026-10-16. Re-check before a submission; the tables change with new
devices. Targets live in `src/targets.mjs`.

| Target | Pixels | Store rule |
|---|---|---|
| `ios-iphone-6.9` | 1320 x 2868 | iPhone with Dynamic Island (large). Optional: falls back to Face ID (large). |
| `ios-iphone-6.3` | 1206 x 2622 | iPhone with Dynamic Island (medium). **Required** (one of 1179 x 2556 or 1206 x 2622). |
| `ios-ipad-13` | 2064 x 2752 | iPad 13 in. **Required**, because `apps/mobile/app.json` sets `ios.supportsTablet`. |
| `play-phone` | 1080 x 1920 | Phone, 9:16, the size Google recommends for featuring. 2 to 8 images, each side 320 to 3840 px, long side at most twice the short side. |
| `play-feature` | 1024 x 500 | Feature graphic. Exactly this size. |

App Store: PNG or JPEG, no alpha, 1 to 10 per device size. Google Play: PNG or
JPEG (24-bit, no alpha), phone 2 to 8, 4 or more recommended. The renderer
flattens every image and strips alpha. The default set is 8 frames, so one
sequence fits both stores; the App Store would take two more.

## The frames

`src/frames.mjs` is the order and the status. Copy is `src/copy/<locale>.json`
(`*word*` becomes the italic accent), pictures are `src/layouts.mjs`, tokens
and bezels `src/styles.css`.

| # | Headline | Picture |
|---|---|---|
| 1 | Keeps you writing, five minutes at a time. | Editor, open on the last sentence |
| 2 | A script that looks like a script. | Screenplay mode (Beta) with the element bar, and a page of the script |
| 3 | A reminder that knows where you left off. | Reminder setup + the personalised notification |
| 4 | Your commute is a writing session. | Sprint, with dictate / listen / sprint callouts |
| 5 | Ciciro suggests. You decide. | Tracked suggestions |
| 6 | Write a little. Get better at it. | Guided exercise + the weekly review's "what to write next" |
| 7 | What color were her eyes? | Story bible |
| 8 | Make it yours. | Three themes side by side |
| held | Scan your handwritten notes into your outline. | Not rendered by default |

Eight frames, so one sequence fits Google Play's limit and the App Store's.
Every claim is a feature the phone ships today; screenplay is marked Beta in
the frame because it is Beta in the app. Manuscript import only creates
chapters (it does not fill the story bible), so there is no frame saying so.

Every render also writes `out/<locale>/gallery.html`: one self-contained page
of every image (previews embedded, each linking to its full-size PNG beside it)
for review.

## Capturing

Captures are PNGs the simulator takes of the real app, at the device's native
size, in `captures/<locale>/<form>/<name>.png`: `phone` (iPhone 17,
1206 x 2622), `tablet` (iPad Pro 13-inch, 2064 x 2752) and, once an Android
build exists, `android` (the renderer falls back to `phone` and trims the iOS
status bar and home indicator, so Play never shows iOS chrome). A frame's
`captures` list in `src/frames.mjs` names what it needs; `--check` lists what
is missing. `captures/<locale>/meta.json` records `{"island": true}` when the
simulator's screenshot already includes the Dynamic Island.

The data is a local server seeded with the homepage's sample book, never
production:

```sh
# repo root: DATABASE_URL="file:./dev.db", CICIRO_REQUIRE_AUTH=true in .env
npm run setup && npx next dev -p 3187
node tools/store-screenshots/seed/seed.mjs          # "The Letter" by Nell Harrow
# apps/mobile/.env: EXPO_PUBLIC_API_URL=http://localhost:3187
cd apps/mobile && npx expo start --dev-client --port 8187
```

Sign in as `store-shots@ciciro.test` (password in `seed/seed.mjs`). Then, with
the simulator booted by the person holding its turn, `capture/sim.sh` cleans
the status bar (9:41, full bars), opens deep links, delivers the reminder
banner (`capture/notification.json`, the title and body the app schedules) and
saves each capture. Which screen each name is:

| Capture | Screen |
|---|---|
| `editor` | Chapter 12, "The Letter", caret at the end of the last sentence |
| `screenplay` | "Ten Minutes", the screenplay, page layout on, element bar over the keyboard |
| `screenplay-pages` | The same script's Pages view (one sheet) |
| `reminder` | Writing reminder form for The Letter (days, time, word goal) |
| `notification` | The reminder banner over the home screen, cropped (`src/crops.mjs`) |
| `sprint` | A sprint running, a few words typed (Ciciro Night) |
| `suggestions`, `suggestions-bar` | Chapter 11 with Ciciro's tracked changes, and the review bar |
| `exercise` | Guided writing exercise, settle-in |
| `weekly-review` | Weekly review for The Letter (the "What to write next" part becomes a card) |
| `bible`, `bible-entry` | Story bible list, and Ines Lind's entry |
| `theme-ciciro`, `theme-night`, `theme-bookshelf` | The editor in Ciciro, Ciciro Night and Bookshelf |

Floating cards are cut from the captures by fractions in `src/crops.mjs`; if a
screen moves, adjust the rect.

## The held scan frame

The camera-scan feature is on `fm/cic-scan-notes` and has not shipped, so its
frame has `status: "planned"` in `src/frames.mjs`. It is skipped by default
and, when forced with `--include-planned`, draws a "PLANNED, NOT SHIPPED, DO NOT
UPLOAD" band so it cannot reach a listing by accident. To use it once the
feature ships:

1. Capture the scan flow as `scan` (phone and tablet) with `capture/sim.sh`.
2. In `src/frames.mjs` set the frame's `status` to `"shipped"` and move it to
   its place in the order. Remove the band from `LAYOUTS.scan` in
   `src/layouts.mjs`.
3. `npm run render`. Google Play takes 8, so drop one frame from its upload.

## Other languages

Add `src/copy/<locale>.json` (same keys), capture the app in that language into
`captures/<locale>/`, and run with `--locale <locale>`. Longer languages may
need a smaller `--h1` in `src/styles.css`'s form blocks; Chinese and Hindi need
a CJK or Devanagari font added to `--serif` and `--sans` in `src/styles.css`.
