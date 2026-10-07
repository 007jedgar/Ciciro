import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ScreenErrorState } from "../components/ScreenErrorState";

const mockRestartApp = jest.fn(async () => {});
jest.mock("../lib/app-restart", () => ({ restartApp: () => mockRestartApp() }));

describe("ScreenErrorState", () => {
  it("shows the friendly message and calls onRetry", () => {
    const onRetry = jest.fn();
    render(<ScreenErrorState message="Could not load manuscripts." onRetry={onRetry} />);

    expect(screen.getByText("Could not load manuscripts.")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("never shows the raw server error outside the details toggle", () => {
    render(
      <ScreenErrorState
        message="Could not load manuscripts."
        detail="500: upstream timeout at db.internal"
        onRetry={jest.fn()}
      />
    );
    expect(screen.queryByText("500: upstream timeout at db.internal")).toBeNull();

    fireEvent.press(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("500: upstream timeout at db.internal")).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.queryByText("500: upstream timeout at db.internal")).toBeNull();
  });

  it("only offers Restart app once the caller says a retry already failed", () => {
    const { rerender } = render(<ScreenErrorState message="Could not load manuscripts." onRetry={jest.fn()} />);
    expect(screen.queryByRole("button", { name: "Restart app" })).toBeNull();

    rerender(
      <ScreenErrorState message="Could not load manuscripts." onRetry={jest.fn()} showRestart />
    );
    expect(screen.getByRole("button", { name: "Restart app" })).toBeTruthy();
  });

  it("restarts the app from the Restart app button", async () => {
    render(<ScreenErrorState message="Could not load manuscripts." onRetry={jest.fn()} showRestart />);
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Restart app" }));
    });
    expect(mockRestartApp).toHaveBeenCalledTimes(1);
  });

  it("disables Try again while a retry is in flight", () => {
    const onRetry = jest.fn();
    render(<ScreenErrorState message="Could not load manuscripts." onRetry={onRetry} retrying />);
    const button = screen.getByRole("button", { name: "Retrying…" });
    fireEvent.press(button);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
