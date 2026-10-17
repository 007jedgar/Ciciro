// Every image a store asks for. All layouts are drawn on a canvas 1000 CSS px
// wide (its height follows the target's aspect) and rasterised at
// deviceScaleFactor = width / 1000, so one design serves every size.
//
// Sizes were read from Apple's "Screenshot specifications" page and Google
// Play Console help on 2026-10-16:
//   App Store: PNG/JPEG, no alpha, 1 to 10 per device size. Required: iPhone
//   with Dynamic Island (medium) 1179x2556 or 1206x2622, and, because
//   apps/mobile/app.json has ios.supportsTablet, the 13-inch iPad
//   (2064x2752 or 2048x2732). The large Dynamic Island sizes (1260x2736,
//   1290x2796, 1320x2868) are optional and fall back to Face ID (large).
//   Google Play: phone screenshots PNG/JPEG no alpha, 2 to 8, each side
//   320 to 3840 px with the long side at most twice the short side; 9:16
//   at 1080x1920 or larger is recommended for featuring. Feature graphic
//   exactly 1024x500, PNG/JPEG no alpha.
// Re-check those pages before a submission: the tables change with new devices.

/**
 * form   "phone" | "tablet" | "graphic": picks the layout variant.
 * device "iphone" | "ipad" | "plain": the bezel drawn around a capture.
 * source which capture folder feeds it (captures/<locale>/<source>/); falls
 *        back to "phone" when a platform has none yet (Android is not built).
 * trim   pixels of the capture to cut off (in capture px) before framing, so
 *        a Play frame carries no iOS status bar or home indicator.
 */
export const TARGETS = {
  "ios-iphone-6.9": {
    store: "App Store",
    label: "iPhone 6.9 in (Dynamic Island, large)",
    width: 1320,
    height: 2868,
    form: "phone",
    device: "iphone",
    source: "phone",
    deviceWidth: 790,
  },
  "ios-iphone-6.3": {
    store: "App Store",
    label: "iPhone 6.3 in (Dynamic Island, medium) - required",
    width: 1206,
    height: 2622,
    form: "phone",
    device: "iphone",
    source: "phone",
    deviceWidth: 790,
  },
  "ios-ipad-13": {
    store: "App Store",
    label: "iPad 13 in - required because the app supports iPad",
    width: 2064,
    height: 2752,
    form: "tablet",
    device: "ipad",
    source: "tablet",
    deviceWidth: 700,
  },
  "play-phone": {
    store: "Google Play",
    label: "Phone, 9:16",
    width: 1080,
    height: 1920,
    form: "phone",
    device: "plain",
    source: "android",
    fallbackSource: "phone",
    trim: { top: 186, bottom: 102 },
    deviceWidth: 650,
  },
  "play-feature": {
    store: "Google Play",
    label: "Feature graphic",
    width: 1024,
    height: 500,
    form: "graphic",
    device: "plain",
    source: "android",
    fallbackSource: "phone",
    trim: { top: 186, bottom: 102 },
    deviceWidth: 330,
  },
};

/** The sets a plain `npm run render` builds. */
export const DEFAULT_TARGETS = Object.keys(TARGETS);
