import { fireEvent, render, screen } from "@testing-library/react-native";
import { PreviouslyOnCard } from "../components/PreviouslyOnCard";
import { StuckPill } from "../components/StuckPill";
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

  it("renders nothing when it is not due or there is no recap", () => {
    dueMock.mockReturnValue(false);
    recapMock.mockReturnValue({ data: undefined });
    render(wrap(<PreviouslyOnCard projectId="p1" />));
    expect(screen.queryByTestId("previously-on")).toBeNull();
    expect(recapMock).toHaveBeenCalledWith("p1", { enabled: false });
  });
});

describe("StuckPill", () => {
  it("asks on open and sends the chosen prompt to the Ciciro tab", () => {
    const mutate = jest.fn();
    stuckMock.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
      data: ["Find the letter.", "Cut to the storm."],
    });
    render(wrap(<StuckPill projectId="p1" chapterId="c1" />));
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("stuck-pill"));
    expect(mutate).toHaveBeenCalledWith({ projectId: "p1", chapterId: "c1" });
    fireEvent.press(screen.getByText("Cut to the storm."));
    expect(mockNavigate).toHaveBeenCalledWith("/project/p1/ciciro?prompt=Cut%20to%20the%20storm.");
  });
});
