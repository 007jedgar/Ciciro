import { act, render } from "@testing-library/react-native";
import { Text } from "react-native";
import { StoryChips } from "../components/onboarding/StoryChips";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import { colors, makeLayout } from "../lib/theme";
import { OnboardingShellProvider, useOnboardingShell, type CarryRequest } from "../lib/onboarding-shell";

// The Reanimated mock resolves every animation at once and reports no layout, so a flight
// has nothing to measure here: these cover the chips the shell keeps, which is what a
// screen reader reads and what coming back to a step takes away.

let shell: ReturnType<typeof useOnboardingShell>;

function Probe() {
  shell = useOnboardingShell();
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
});
