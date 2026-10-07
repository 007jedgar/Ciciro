import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { ScreenErrorBoundary } from "../components/ScreenErrorBoundary";

jest.mock("../lib/app-restart", () => ({ restartApp: jest.fn(async () => {}) }));

/** Throws on the first render, renders fine from then on - like a transient crash a retry clears. */
function FlakyChild({ fail }: { fail: () => boolean }) {
  if (fail()) throw new Error("boom: undefined is not an object");
  return <Text>Recovered</Text>;
}

describe("ScreenErrorBoundary", () => {
  // react-test-renderer logs caught errors to the console; keep the suite's
  // output clean without hiding a real assertion failure.
  let consoleError: jest.SpyInstance;
  beforeEach(() => {
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it("shows the recovery UI instead of a dead screen when a child throws", () => {
    render(
      <ScreenErrorBoundary>
        <FlakyChild fail={() => true} />
      </ScreenErrorBoundary>
    );
    expect(screen.getByText("Something went wrong loading this screen.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    // A first crash gets a retry before Restart app is offered.
    expect(screen.queryByRole("button", { name: "Restart app" })).toBeNull();
  });

  it("recovers the real screen when Try again re-renders past the crash", () => {
    let shouldFail = true;
    render(
      <ScreenErrorBoundary>
        <FlakyChild fail={() => shouldFail} />
      </ScreenErrorBoundary>
    );
    expect(screen.getByText("Something went wrong loading this screen.")).toBeTruthy();

    shouldFail = false;
    fireEvent.press(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("Recovered")).toBeTruthy();
    expect(screen.queryByText("Something went wrong loading this screen.")).toBeNull();
  });

  it("offers Restart app once a retry still crashes", () => {
    render(
      <ScreenErrorBoundary>
        <FlakyChild fail={() => true} />
      </ScreenErrorBoundary>
    );
    fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("button", { name: "Restart app" })).toBeTruthy();
  });
});
