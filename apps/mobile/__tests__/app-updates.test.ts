import { FOREGROUND_CHECK_INTERVAL_MS, createForegroundUpdateCheck, type UpdatesClient } from "../lib/app-updates";

function client(isAvailable: boolean, overrides: Partial<UpdatesClient> = {}): UpdatesClient {
  return {
    isEnabled: true,
    checkForUpdateAsync: jest.fn(async () => ({ isAvailable })),
    fetchUpdateAsync: jest.fn(async () => ({})),
    ...overrides,
  };
}

const HOUR = FOREGROUND_CHECK_INTERVAL_MS;

describe("createForegroundUpdateCheck", () => {
  it("leaves the first hour to the launch check", async () => {
    const updates = client(true);
    const check = createForegroundUpdateCheck(updates, 0);
    await expect(check(HOUR - 1)).resolves.toBe("skipped");
    expect(updates.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it("downloads an available update and never reloads", async () => {
    const updates = client(true) as UpdatesClient & { reloadAsync?: jest.Mock };
    updates.reloadAsync = jest.fn();
    const check = createForegroundUpdateCheck(updates, 0);
    await expect(check(HOUR)).resolves.toBe("downloaded");
    expect(updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(updates.reloadAsync).not.toHaveBeenCalled();
    // Downloaded once: the next launch runs it, so stop checking.
    await expect(check(3 * HOUR)).resolves.toBe("skipped");
  });

  it("checks at most hourly", async () => {
    const updates = client(false);
    const check = createForegroundUpdateCheck(updates, 0);
    await expect(check(HOUR)).resolves.toBe("current");
    await expect(check(HOUR + 60_000)).resolves.toBe("skipped");
    await expect(check(2 * HOUR)).resolves.toBe("current");
    expect(updates.checkForUpdateAsync).toHaveBeenCalledTimes(2);
  });

  it("does nothing where updates are off (development)", async () => {
    const updates = client(true, { isEnabled: false });
    await expect(createForegroundUpdateCheck(updates, 0)(10 * HOUR)).resolves.toBe("skipped");
    expect(updates.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it("reports a failed check and tries again later", async () => {
    const updates = client(true, {
      checkForUpdateAsync: jest
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ isAvailable: false }),
    });
    const check = createForegroundUpdateCheck(updates, 0);
    await expect(check(HOUR)).resolves.toBe("failed");
    await expect(check(2 * HOUR)).resolves.toBe("current");
  });
});
