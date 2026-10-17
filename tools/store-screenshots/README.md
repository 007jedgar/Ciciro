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

| # | Headline | Picture | What it sells |
|---|---|---|---|
| 1 | Build a writing habit, five minutes at a time. | Editor, open on the last sentence | The habit, for people who write in stolen minutes |
| 2 | Write a script that looks like a script. | Screenplay mode (Beta) with the element bar, and a page of the script | A real screenplay format on a phone |
| 3 | Get a reminder that knows where you left off. | Reminder setup + the personalised notification | Reminders that quote your last lines and nudge you back in |
| 4 | Make your commute a writing session. | Sprint, with 15 min sprint / saves offline / listen back callouts | Small pockets of time |
| 5 | Let Ciciro suggest. You decide. | A limp metaphor swapped for a concrete one, as a tracked change | Edits that make the writing better, and stay yours |
| 6 | Learn to enjoy writing. | The guided exercises, and the weekly review's "what to write next" | Habit and getting better |
| 7 | Keep every detail straight. | Story bible, with a character entry | Canon beside the chapters |
| 8 | Make it yours. | Three themes side by side | Eight themes |
| held | Scan your handwritten notes into your story bible. | Not rendered by default | Planned, see below |

Headlines are action-oriented on purpose: "Make your commute a writing
session", not "Your commute is a writing session".

The sample content is one coherent, funny world rather than literary drama,
because people do read store screenshots: "Belt Buckle First" is a satire in
which an alien invasion lifts everyone in Dayton into the sky belt buckle first
and the narrator, Dale, wants to know why he is not going up like everyone
else. The screenplay is a scene from the same world, the story bible is its
canon, the reminder quotes its last lines, and the suggestion swaps a flat
metaphor for one you can see. `seed/seed.mjs` writes all of it.

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
is missing.

`captures/<locale>/meta.json` carries two facts about the set:

- `"app": "<sha>"`: the app commit the captures were taken from. If
  `apps/mobile` has changed a screen a frame shows since (`git log <sha>..
  -- apps/mobile`), re-capture that screen; the renderer cannot tell.
- `"island": true`: the screenshot already includes the Dynamic Island, so the
  bezel does not draw one.
- `"keyboard": { "<capture>": { "top": <px>, "fill": "<css colour>" } }`: the
  capture has the iOS software keyboard up. App Store frames keep it (it is the
  real screen); Google Play frames paint it out in the page colour, since the
  iOS keyboard is iOS chrome. The simulator cannot dismiss the keyboard while an
  editor is open, which is why the editor frame has one.

The data is a local server seeded with the homepage's sample book, never
production:

```sh
# repo root: DATABASE_URL="file:./dev.db", CICIRO_REQUIRE_AUTH=true in .env
npm run setup && npx next dev -p 3187
node tools/store-screenshots/seed/seed.mjs --reset   # "Belt Buckle First" and the script "Number Forty-Seven"
# apps/mobile/.env: EXPO_PUBLIC_API_URL=http://localhost:3187
cd apps/mobile && npx expo start --dev-client --port 8187
```

Sign in as `store-shots@ciciro.test` (password in `seed/seed.mjs`). Then, with
the simulator booted by the person holding its turn, `capture/sim.sh` cleans
the status bar (9:41, full bars), opens deep links, delivers the reminder
banner (`capture/notification.json`, the title and body shape the app
schedules, with the last lines of chapter 7, "A Fair Question") and saves each capture. Which
screen each name is:

| Capture | Screen |
|---|---|
| `editor` | Chapter 1, "Tuesday", caret at the end of the last sentence |
| `screenplay` | "Number Forty-Seven", the screenplay, page layout on (Settings > Screenplay > Page layout while typing), element bar |
| `screenplay-pages` | The same script's Pages tile (one sheet, with page numbers) |
| `reminder` | Writing reminder form for Belt Buckle First: 250 words, 8:00 AM, Mon / Wed / Thu / Sat |
| `notification` | The reminder banner over the home screen, long-pressed to expand; cropped by `src/crops.mjs` |
| `sprint` | A 15 minute sprint running, Ciciro Night, a few words typed first (chapter 1 is restored afterwards) |
| `suggestions` | Chapter 4, "Aisle Nine", with three tracked changes from Ciciro, the Suggestions sheet open |
| `exercise-picker` | The guided writing exercises: the list of four |
| `weekly-review-next` | Weekly review for Belt Buckle First, scrolled to "What to write next" (the seed writes the review directly, so no model call is spent) |
| `bible`, `bible-entry` | Story bible list, and Rhonda Pruitt's entry |
| `theme-ciciro`, `theme-night`, `theme-bookshelf` | The chapters tab of Belt Buckle First in each theme (Settings > Theme) |

Floating cards are cut from the captures by fractions in `src/crops.mjs` (phone
and tablet have their own rects); if a screen moves, adjust the rect. The
renderer never draws app UI itself: every pixel inside a device is a capture.

## Google Play and Android

There is no Android build to capture yet, so the Play set (`play-phone`, 1080 x
1920, and the 1024 x 500 feature graphic) reuses the iPhone captures: the renderer
trims the iOS status bar (top 186 px) and home indicator (bottom 102 px), draws a
plain slab with no brand, notch or Dynamic Island, and paints out the iOS
keyboard where a capture has one (`meta.json`, above). No iOS chrome is left in
a Play image. When an Android build exists, take the same captures on an
emulator into `captures/en/android/` (one name per capture, same list); the
renderer prefers that folder and stops trimming, with no code change. Play
takes at most 8 phone screenshots, which is exactly the set; if the scan frame
ships (below) and the set becomes 9, drop one from the Play upload (the App
Store takes 10).

## The held scan frame

Scan notes (photograph handwritten or printed notes, check the text, add it to
the story bible or the outline cards) landed on `main` as #198, after this set
was captured. It needs a native build (the camera and photo permissions come
from the `expo-image-picker` plugin), so it reaches an author with the next
store release, not with an OTA update. Until that release is out and it has
been captured, its frame has `status: "planned"` in `src/frames.mjs`: skipped
by default and, when forced with `--include-planned`, drawn with a "PLANNED,
NOT SHIPPED, DO NOT UPLOAD" band so it cannot reach a listing by accident. To
swap it in:

1. Rebuild the dev client from current `main` (`npx expo run:ios` in
   `apps/mobile`) and capture the flow as `scan` on a phone and an iPad with
   `capture/sim.sh`. The simulator has no camera, so choose "Choose from
   library" with a photo added by `xcrun simctl addmedia <udid> <image>`;
   reading it spends one model call, so the local server needs its API key.
   The review step ("Check the text") is the screen worth showing.
2. In `src/frames.mjs` set the frame's `status` to `"shipped"` and move it to
   its place in the order. Remove the band from `LAYOUTS.scan` in
   `src/layouts.mjs`.
3. Re-read `scan` in `src/copy/en.json` against what shipped, then
   `npm run render`. Google Play takes 8, so drop one frame from its upload.

## Other languages

Add `src/copy/<locale>.json` (same keys), capture the app in that language into
`captures/<locale>/`, and run with `--locale <locale>`. Longer languages may
need a smaller `--h1` in `src/styles.css`'s form blocks; Chinese and Hindi need
a CJK or Devanagari font added to `--serif` and `--sans` in `src/styles.css`.
