import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import OnboardingDemoScreen from "../app/onboarding/demo";
import OnboardingExercisesScreen from "../app/onboarding/exercises";
import { EXERCISES } from "../lib/writing-exercise";

const mockPush = jest.fn();
const mockTrack = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock("../lib/use-stack-back", () => ({ useStackBack: () => ({ backOr: jest.fn() }) }));
jest.mock("../lib/analytics-client", () => ({ getAnalytics: () => ({ track: mockTrack }) }));
jest.mock("../lib/settings", () => ({
  useAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), settings: { reduceMotion: true } };
  },
  useOptionalAppTheme: () => ({ settings: { reduceMotion: true } }),
}));
// The frame's title writes itself in and its blocks rise, which is the shell's business, not this step's.
jest.mock("../components/onboarding/OnboardingFrame", () => {
  const { Pressable: Press, Text: Label, View: Box } = jest.requireActual("react-native");
  return {
    Rise: ({ children }: { children: ReactNode }) => <Box>{children}</Box>,
    OnboardingFrame: ({
      title,
      body,
      footer,
      onSkip,
      children,
    }: {
      title: string;
      body?: string;
      footer?: ReactNode;
      onSkip: () => void;
      children: ReactNode;
    }) => (
      <Box>
        <Label>{title}</Label>
        {body ? <Label>{body}</Label> : null}
        <Press accessibilityRole="button" accessibilityLabel="Skip" onPress={onSkip} />
        {children}
        {footer}
      </Box>
    ),
  };
});
// Each demo stands in as a button that finishes it, whichever the answers open.
jest.mock("../components/onboarding/FocusDemo", () => {
  const { Pressable: Press } = jest.requireActual("react-native");
  return { FocusDemo: ({ onContinue }: { onContinue: () => void }) => <Press accessibilityLabel="Finish demo" onPress={onContinue} /> };
});
jest.mock("../components/onboarding/SuggestionsDemo", () => {
  const { Pressable: Press } = jest.requireActual("react-native");
  return {
    SuggestionsDemo: ({ onContinue }: { onContinue: () => void }) => <Press accessibilityLabel="Finish demo" onPress={onContinue} />,
  };
});
jest.mock("../components/onboarding/ScreenplayDemo", () => {
  const { Pressable: Press } = jest.requireActual("react-native");
  return {
    ScreenplayDemo: ({ onContinue }: { onContinue: () => void }) => <Press accessibilityLabel="Finish demo" onPress={onContinue} />,
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});

describe("after the demo", () => {
  function finishDemo(params: Record<string, string>) {
    mockParams = params;
    render(<OnboardingDemoScreen />);
    fireEvent.press(screen.getByLabelText("Finish demo"));
  }

  it.each(["creativity", "block"])("tells someone who picked %s about the writing exercises", (obstacle) => {
    finishDemo({ kind: "novel", obstacles: obstacle });
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/onboarding/exercises",
      params: { kind: "novel", obstacles: obstacle },
    });
  });

  it("does so whichever demo their kind opens", () => {
    finishDemo({ kind: "screenplay", obstacles: "block" });
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/onboarding/exercises" }));
  });

  it("goes straight to signup for the other obstacles, as before", () => {
    finishDemo({ kind: "novel", obstacles: "zone,self_criticism" });
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/signup",
      params: { kind: "novel", obstacles: "zone,self_criticism" },
    });
  });

  it("goes to the reminder form for consistency, as before", () => {
    finishDemo({ kind: "novel", obstacles: "consistency" });
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/onboarding/reminder" }));
  });

  it("still tells them about the exercises first when they also asked for a reminder", () => {
    finishDemo({ kind: "novel", obstacles: "block,consistency" });
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/onboarding/exercises",
      params: { kind: "novel", obstacles: "block,consistency" },
    });
  });
});

describe("the writing-exercises step", () => {
  it("names the exercises, how long each takes, and where to find them once signed in", () => {
    mockParams = { kind: "novel", obstacles: "creativity" };
    render(<OnboardingExercisesScreen />);
    expect(screen.getByText("There are writing exercises, too")).toBeTruthy();
    // One row per exercise the app has, each read out as its name and what it is for.
    expect(screen.getAllByLabelText(/^[^.]+\. .+/).length).toBeGreaterThanOrEqual(EXERCISES.length);
    expect(screen.getByText("Pour it out")).toBeTruthy();
    expect(screen.getByText("One true sentence")).toBeTruthy();
    expect(screen.getByText("The terrible first draft")).toBeTruthy();
    expect(screen.getByText("A list of nouns")).toBeTruthy();
    expect(screen.getByText("Observe, react, narrate")).toBeTruthy();
    expect(screen.getAllByText("10 MIN")).toHaveLength(2);
    expect(screen.getByText("21 MIN")).toBeTruthy();
    expect(screen.getByText("9 MIN")).toBeTruthy();
    expect(screen.getByText("8 MIN")).toBeTruthy();
    expect(screen.getByText(/under \+ on your manuscripts/)).toBeTruthy();
  });

  it("is only a mention: no exercise can be started from it", () => {
    mockParams = { kind: "novel", obstacles: "block" };
    render(<OnboardingExercisesScreen />);
    expect(screen.queryByRole("button", { name: /Begin/ })).toBeNull();
    expect(screen.getAllByRole("button").map((b) => b.props.accessibilityLabel).sort()).toEqual(["Continue", "Skip"]);
  });

  it("records that it was shown", () => {
    mockParams = { kind: "novel", obstacles: "block" };
    render(<OnboardingExercisesScreen />);
    expect(mockTrack).toHaveBeenCalledWith("onboarding_exercises_viewed", {});
  });

  it("continues to signup, carrying the answers", () => {
    mockParams = { kind: "journal", obstacles: "block" };
    render(<OnboardingExercisesScreen />);
    fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/signup", params: { kind: "journal", obstacles: "block" } });
  });

  it("continues to the reminder form for someone who also picked consistency", () => {
    mockParams = { kind: "novel", obstacles: "block,consistency" };
    render(<OnboardingExercisesScreen />);
    fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/onboarding/reminder",
      params: { kind: "novel", obstacles: "block,consistency" },
    });
  });

  it("skips straight to signup like every other step", () => {
    mockParams = { kind: "novel", obstacles: "block,consistency" };
    render(<OnboardingExercisesScreen />);
    fireEvent.press(screen.getByRole("button", { name: "Skip" }));
    expect(mockTrack).toHaveBeenCalledWith("onboarding_skipped", { step: "exercises" });
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/signup",
      params: { kind: "novel", obstacles: "block,consistency" },
    });
  });
});
