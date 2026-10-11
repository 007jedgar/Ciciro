import type { ReactNode } from "react";
import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ForceUpdateGate } from "../components/ForceUpdateGate";

const mockUseForceUpdateGate = jest.fn();
jest.mock("../lib/force-update", () => ({
  useForceUpdateGate: () => mockUseForceUpdateGate(),
  openStoreListing: jest.fn(async () => {}),
}));

const initialMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderWithSafeArea(node: ReactNode) {
  return render(<SafeAreaProvider initialMetrics={initialMetrics}>{node}</SafeAreaProvider>);
}

describe("ForceUpdateGate", () => {
  it("renders its children when not blocked", () => {
    mockUseForceUpdateGate.mockReturnValue(false);
    renderWithSafeArea(
      <ForceUpdateGate>
        <Text>App content</Text>
      </ForceUpdateGate>
    );
    expect(screen.getByText("App content")).toBeTruthy();
    expect(screen.queryByText("Update required")).toBeNull();
  });

  it("replaces its children with the blocking screen once below the minimum", () => {
    mockUseForceUpdateGate.mockReturnValue(true);
    renderWithSafeArea(
      <ForceUpdateGate>
        <Text>App content</Text>
      </ForceUpdateGate>
    );
    expect(screen.getByText("Update required")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
    expect(screen.queryByText("App content")).toBeNull();
  });
});
