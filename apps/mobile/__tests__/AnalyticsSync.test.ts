import { pauseResumeOnAppState } from "../components/AnalyticsSync";

describe("pauseResumeOnAppState", () => {
  function fakeAppState() {
    let handler: ((status: string) => void) | null = null;
    const appState = {
      addEventListener: (_type: "change", next: (status: string) => void) => {
        handler = next;
        return {
          remove: () => {
            handler = null;
          },
        };
      },
    };
    return { appState, change: (status: string) => handler?.(status) };
  }

  it("calls onBackground for background and inactive, onForeground for active", () => {
    const { appState, change } = fakeAppState();
    const calls: string[] = [];
    pauseResumeOnAppState(
      appState,
      () => calls.push("background"),
      () => calls.push("foreground")
    );
    change("background");
    change("active");
    change("inactive");
    change("active");
    expect(calls).toEqual(["background", "foreground", "background", "foreground"]);
  });

  it("stops notifying once removed", () => {
    const { appState, change } = fakeAppState();
    const calls: string[] = [];
    const stop = pauseResumeOnAppState(
      appState,
      () => calls.push("background"),
      () => calls.push("foreground")
    );
    stop();
    change("background");
    change("active");
    expect(calls).toEqual([]);
  });
});
