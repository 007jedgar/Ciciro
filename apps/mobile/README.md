# Ciciro mobile

React Native + Expo client for hosted Ciciro. It talks to the HTTP API only. Model keys stay on the server.

## Run

```bash
cd apps/mobile
cp .env.example .env    # set EXPO_PUBLIC_API_URL to your hosted origin
npx expo start
```

From the repo root: `npm run mobile:start`.

Point `EXPO_PUBLIC_API_URL` at the deployed app, not at Anthropic. Account and secret setup is in [docs/setup-accounts.md](../../docs/setup-accounts.md).

Expo Go is fine for this first slice. A custom dev client (`npx expo install expo-dev-client`, then `npx expo run:ios` / `run:android`) is the longer-term device target.

This is not an architecture spec. Do not copy unpublished `docs/mobile/` notes into this tree.
