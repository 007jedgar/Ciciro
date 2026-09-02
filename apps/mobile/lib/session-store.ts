import * as SecureStore from "expo-secure-store";

const KEY = "ciciro_session";

let memoryToken: string | null = null;

export function getSessionToken(): string | null {
  return memoryToken;
}

export function setSessionToken(token: string | null): void {
  memoryToken = token;
  if (token) {
    void SecureStore.setItemAsync(KEY, token).catch(() => {
      /* web / missing native module */
    });
  } else {
    void SecureStore.deleteItemAsync(KEY).catch(() => {});
  }
}

export async function hydrateSessionToken(): Promise<string | null> {
  try {
    const stored = await SecureStore.getItemAsync(KEY);
    memoryToken = stored;
    return stored;
  } catch {
    return memoryToken;
  }
}
