# Ciciro mobile

React Native + Expo client for hosted Ciciro. It talks to the HTTP API only. Model keys stay on the server.

## Run

```bash
cd apps/mobile
cp .env.example .env    # set EXPO_PUBLIC_API_URL to your hosted origin
npx expo run:ios        # or: npx expo run:android
```

From the repo root: `npm run mobile:start` still starts Metro. Native modules (op-sqlite, MMKV, the native editor, `expo-speech-recognition` for dictation) need a development build, not Expo Go: `npx expo run:ios` / `npx expo run:android`, or `npx expo start --dev-client` against an existing binary.

Dictation uses `expo-speech-recognition`, configured by its plugin in `app.json` (iOS microphone and speech recognition usage strings, Android `RECORD_AUDIO`). After pulling this change, rebuild the dev client (`npx expo prebuild` or `npx expo run:ios`); an existing binary will not have the module and simply hides the microphone button.

Point `EXPO_PUBLIC_API_URL` at the deployed app, not at Anthropic. Account and secret setup is in [docs/setup-accounts.md](../../docs/setup-accounts.md).

This is not an architecture spec. Do not copy unpublished `docs/mobile/` notes into this tree.

## Native stack

Installed against Expo SDK 57 for native feel, transitions, and a local replica:

- **Motion / drawing:** Reanimated + Worklets, Gesture Handler, Skia, Keyboard Controller
- **Lists / sheets / chrome:** FlashList, bottom sheets, Masked View, SVG, Blur, Glass, Haptics, Image, Linear Gradient, Symbols
- **Editor:** `react-native-enriched-html` (native text, not a WebView)
- **Local data:** op-sqlite with FTS5 + performance mode (`lib/db.ts`)
- **HTTP:** TanStack Query + a typed client in `lib/api/` for the hosted JSON/NDJSON API
- MMKV for prefs (`lib/prefs.ts`); session tokens stay in SecureStore
- Legend-State for chrome; NetInfo for connectivity
