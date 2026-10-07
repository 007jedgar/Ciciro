import { DevSettings } from "react-native";
import { restartApp, type RestartClient } from "../lib/app-restart";

function client(overrides: Partial<RestartClient> = {}): RestartClient {
  return {
    isEnabled: true,
    reloadAsync: jest.fn(async () => {}),
    ...overrides,
  };
}

describe("restartApp", () => {
  it("reloads through expo-updates when it is enabled", async () => {
    const updates = client();
    await restartApp(updates);
    expect(updates.reloadAsync).toHaveBeenCalledTimes(1);
  });

  it("falls back to DevSettings.reload when expo-updates is off", async () => {
    const reload = jest.spyOn(DevSettings, "reload").mockImplementation(() => {});
    const updates = client({ isEnabled: false });
    await restartApp(updates);
    expect(updates.reloadAsync).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    reload.mockRestore();
  });

  it("throws when neither reload path is available", async () => {
    const original = DevSettings.reload;
    (DevSettings as { reload?: unknown }).reload = undefined;
    await expect(restartApp(client({ isEnabled: false }))).rejects.toThrow();
    (DevSettings as { reload?: unknown }).reload = original;
  });
});
