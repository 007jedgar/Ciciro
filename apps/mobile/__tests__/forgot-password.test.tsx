import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "i18next";
import ForgotPasswordScreen from "../app/forgot-password";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import "../lib/i18n";
import { makeLayout, THEME_PALETTES } from "../lib/theme";

const mockForgot = jest.fn();
const mockBackOr = jest.fn();
let mockParams: { email?: string } = {};

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: "success", Error: "error", Warning: "warning" },
}));
jest.mock("expo-router", () => ({ useLocalSearchParams: () => mockParams }));
jest.mock("../lib/use-stack-back", () => ({ useStackBack: () => ({ backOr: mockBackOr }) }));
jest.mock("../components/AppHeader", () => ({ AppHeader: () => null, useAppHeaderHeight: () => 0, useMeasuredAppHeaderHeight: () => [0, () => {}] }));
jest.mock("../lib/api", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { ApiError, ciciro: { auth: { forgotPassword: (body: unknown) => mockForgot(body) } } };
});

function renderScreen() {
  const settings = defaultSettings();
  const colors = THEME_PALETTES[settings.theme];
  return render(
    <AppThemeContext.Provider
      value={{ settings, colors, layout: makeLayout(colors, settings.editorFont), dark: false, patch: jest.fn() }}
    >
      <ForgotPasswordScreen />
    </AppThemeContext.Provider>
  );
}

describe("Forgot password", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  beforeEach(() => {
    mockParams = {};
    mockForgot.mockReset();
    mockBackOr.mockReset();
  });

  it("starts from the email typed on the sign-in screen and sends the link", async () => {
    mockParams = { email: "ada@example.com" };
    mockForgot.mockResolvedValue({ ok: true });
    renderScreen();
    expect(screen.getByLabelText("Email").props.value).toBe("ada@example.com");
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Send reset link" }));
    });
    expect(mockForgot).toHaveBeenCalledWith({ email: "ada@example.com" });
    expect(screen.getByText(/If ada@example.com has a Ciciro account/)).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Back to sign in" }));
    expect(mockBackOr).toHaveBeenCalledWith("/login");
  });

  it("checks the address before asking the server", async () => {
    renderScreen();
    fireEvent.changeText(screen.getByLabelText("Email"), "not-an-email");
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Send reset link" }));
    });
    expect(mockForgot).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a valid email.")).toBeTruthy();
  });

  it("shows the server's error and keeps the form", async () => {
    const { ApiError } = jest.requireMock("../lib/api");
    mockForgot.mockRejectedValue(new ApiError("Could not send the email. Try again.", 500));
    renderScreen();
    fireEvent.changeText(screen.getByLabelText("Email"), "ada@example.com");
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Send reset link" }));
    });
    expect(screen.getByText("Could not send the email. Try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeTruthy();
  });
});
