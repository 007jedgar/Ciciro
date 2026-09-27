import { fireEvent, render, screen } from "@testing-library/react-native";
import { PreviouslyOnCard } from "../components/PreviouslyOnCard";
import { StuckSheet } from "../components/StuckSheet";
import { useRecapQuery, useStuckPromptsMutation } from "../lib/api";
import { recapDue } from "../lib/recap";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import { colors, makeLayout } from "../lib/theme";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

const mockNavigate = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ navigate: mockNavigate }) }));
jest.mock("../lib/api", () => ({
  useRecapQuery: jest.fn(),
  useStuckPromptsMutation: jest.fn(),
}));
jest.mock("../lib/recap", () => ({
  ...jest.requireActual("../lib/recap"),
  recapDue: jest.fn(),
}));

const recapMock = useRecapQuery as jest.Mock;
const stuckMock = useStuckPromptsMutation as jest.Mock;
const dueMock = recapDue as jest.Mock;

function wrap(ui: ReactNode) {
  return (
    <AppThemeContext.Provider
      value={{ settings: defaultSettings(), colors, layout: makeLayout(colors), dark: false, patch: () => {} }}
    >
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        {ui}
      </SafeAreaProvider>
    </AppThemeContext.Provider>
  );
}

describe("PreviouslyOnCard", () => {
  it("shows the recap and dismisses it", () => {
    dueMock.mockReturnValue(true);
    recapMock.mockReturnValue({ data: { text: "You left Marta on the pier.", generatedAt: "" } });
    render(wrap(<PreviouslyOnCard projectId="p1" />));
    expect(screen.getByText("You left Marta on the pier.")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Dismiss"));
    expect(screen.queryByTestId("previously-on")).toBeNull();
  });

  it("holds the card's place with skeleton lines while the recap is written", () => {
    dueMock.mockReturnValue(true);
    recapMock.mockReturnValue({ data: undefined, isPending: true });
    render(wrap(<PreviouslyOnCard projectId="p1" />));
    expect(screen.getByTestId("previously-on-loading")).toBeTruthy();
    expect(screen.getByText("Previously on")).toBeTruthy();
    expect(screen.getAllByLabelText("Catching up on the story so far…").length).toBeGreaterThan(1);
    expect(screen.queryByTestId("previously-on")).toBeNull();
  });

  it("renders nothing when it is not due or there is no recap", () => {
    dueMock.mockReturnValue(false);
    recapMock.mockReturnValue({ data: undefined });
    render(wrap(<PreviouslyOnCard projectId="p1" />));
    expect(screen.queryByTestId("previously-on")).toBeNull();
    expect(recapMock).toHaveBeenCalledWith("p1", { enabled: false });
  });
});

describe("StuckSheet", () => {
  const data = ["Find the letter.", "Cut to the storm."];

  it("asks when opened and sends the chosen prompt to the Ciciro tab", () => {
    const mutate = jest.fn();
    const onClose = jest.fn();
    stuckMock.mockReturnValue({ mutate, isPending: false, isError: false, data });
    render(wrap(<StuckSheet open onClose={onClose} projectId="p1" chapterId="c1" />));
    expect(mutate).toHaveBeenCalledWith({ projectId: "p1", chapterId: "c1" });
    fireEvent.press(screen.getByText("Cut to the storm."));
    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/project/p1/ciciro?prompt=Cut%20to%20the%20storm.");
  });

  it("shows skeleton ideas while Ciciro thinks", () => {
    stuckMock.mockReturnValue({ mutate: jest.fn(), isPending: true, isError: false, data: undefined });
    render(wrap(<StuckSheet open onClose={() => {}} projectId="p1" chapterId="c1" />));
    expect(screen.getByTestId("loading-block")).toBeTruthy();
    expect(screen.getAllByLabelText("Looking for ways forward…").length).toBeGreaterThan(1);
  });

  it("does not ask while closed", () => {
    const mutate = jest.fn();
    stuckMock.mockReturnValue({ mutate, isPending: false, isError: false, data });
    render(wrap(<StuckSheet open={false} onClose={() => {}} projectId="p1" chapterId="c1" />));
    expect(mutate).not.toHaveBeenCalled();
  });
});
