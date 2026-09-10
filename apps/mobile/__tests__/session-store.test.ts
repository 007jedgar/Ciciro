import * as SecureStore from "expo-secure-store";
import {
  getCachedUser,
  getSessionToken,
  hydrateSessionToken,
  resetSessionMemory,
  setCachedUser,
  setSessionToken,
} from "../lib/session-store";

describe("session store", () => {
  beforeEach(() => {
    setSessionToken(null);
    setCachedUser(null);
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  });

  it("restores a token from disk after in-memory state is wiped", () => {
    setSessionToken("persisted-token");
    resetSessionMemory();
    expect(getSessionToken()).toBe("persisted-token");
  });

  it("hydrates from SecureStore when memory and disk are empty", async () => {
    setSessionToken(null);
    resetSessionMemory();
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue("secure-token");
    await expect(hydrateSessionToken()).resolves.toBe("secure-token");
    expect(getSessionToken()).toBe("secure-token");
  });

  it("round-trips a cached user", () => {
    const user = { id: "u1", email: "ada@example.com", name: "Ada" };
    setCachedUser(user);
    expect(getCachedUser()).toEqual(user);
    setCachedUser(null);
    expect(getCachedUser()).toBeNull();
  });
});
