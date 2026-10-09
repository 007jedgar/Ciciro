import { act, render } from "@testing-library/react-native";
import { Text } from "react-native";
import { StoryChips } from "../components/onboarding/StoryChips";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import { colors, makeLayout } from "../lib/theme";
import { OnboardingShellProvider, useCarry, useOnboardingShell, type CarryRequest } from "../lib/onboarding-shell";

const blurs: (() => void)[] = [];
jest.mock("expo-router", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => {
        const cleanup = effect();
        if (cleanup) blurs.push(cleanup);
      }, [effect]);
    },
  };
});

// The Reanimated mock resolves every animation at once and reports no layout, so a flight
// has nothing to measure here: these cover the chips the shell keeps, which is what a
// screen reader reads and what coming back to a step takes away.

let shell: ReturnType<typeof useOnboardingShell>;

let carry: ReturnType<typeof useCarry>;

function Probe() {
  shell = useOnboardingShell();
  carry = useCarry();
  return <Text>probe</Text>;
}

function mount() {
  return render(
    <AppThemeContext.Provider
      value={{ settings: defaultSettings(), colors, layout: makeLayout(colors), dark: false, patch: () => {} }}
    >
      <OnboardingShellProvider>
        <Probe />
        <StoryChips />
      </OnboardingShellProvider>
    </AppThemeContext.Provider>
  );
}

function request(id: string, step: CarryRequest["chip"]["step"], label: string): CarryRequest {
  return {
    chip: { id, step, label },
    card: null,
    title: null,
    look: {
      background: "#fff",
      border: "#000",
      borderWidth: 1,
      radius: 10,
      title: { text: label, color: "#000", fontSize: 18 },
    },
  };
}

describe("OnboardingShell chips", () => {
  it("shows no summary while nothing has been answered", () => {
    const view = mount();
    expect(view.queryByLabelText(/Your answers/)).toBeNull();
    view.unmount();
  });

  it("collects answers as chips and reads them as one summary", async () => {
    const view = mount();
    await act(async () => {
      await shell.fly([request("kind", "goal", "Novel")]);
      await shell.fly([request("obstacle:zone", "obstacle", "Creativity"), request("obstacle:block", "obstacle", "Writer's block")]);
    });
    expect(view.getByLabelText("Your answers: Novel, Creativity, Writer's block")).toBeTruthy();
    view.unmount();
  });

  it("takes back the chips of a step shown again", async () => {
    const view = mount();
    await act(async () => {
      await shell.fly([request("kind", "goal", "Novel")]);
      await shell.fly([request("obstacle:zone", "obstacle", "Creativity")]);
    });
    act(() => shell.retract("obstacle"));
    expect(view.getByLabelText("Your answers: Novel")).toBeTruthy();
    view.unmount();
  });

  it("ignores back and Skip while a carry is in the air", async () => {
    const view = mount();
    const onBack = jest.fn();
    const onSkip = jest.fn();
    act(() => shell.claim({ step: "obstacle", steps: ["goal", "obstacle"], handlers: { current: { onBack, onSkip } } }));
    await act(async () => {
      const flying = shell.fly([request("kind", "goal", "Novel")]);
      shell.back();
      shell.skip();
      await flying;
    });
    expect(onBack).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
    act(() => shell.back());
    act(() => shell.skip());
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("does not let a screen left mid-flight push, and takes back its chips", async () => {
    const view = mount();
    await act(async () => {
      await shell.fly([request("kind", "goal", "Novel")]);
    });
    let flying: boolean | undefined;
    await act(async () => {
      const pending = carry.fly([request("obstacle:zone", "obstacle", "Creativity")]);
      blurs.forEach((blur) => blur());
      flying = await pending;
    });
    expect(flying).toBe(false);
    expect(view.getByLabelText("Your answers: Novel")).toBeTruthy();
    view.unmount();
  });

  it("lets go of input when a measurement never reports back", async () => {
    jest.useFakeTimers();
    try {
      const view = mount();
      const onBack = jest.fn();
      act(() => shell.claim({ step: "goal", steps: ["goal"], handlers: { current: { onBack, onSkip: jest.fn() } } }));
      const stalled = { ...request("kind", "goal", "Novel"), card: { measureInWindow: () => {} } };
      let done = false;
      act(() => {
        void shell.fly([stalled]).then(() => {
          done = true;
        });
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });
      expect(done).toBe(true);
      act(() => shell.back());
      expect(onBack).toHaveBeenCalledTimes(1);
      view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });
});
