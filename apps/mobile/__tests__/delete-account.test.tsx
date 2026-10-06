import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "i18next";
import DeleteAccountScreen from "../app/delete-account";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import "../lib/i18n";
import { makeLayout, THEME_PALETTES } from "../lib/theme";

const mockResetTo = jest.fn();
const mockDeleteAccount = jest.fn();
const mockRunExport = jest.fn();
let mockUser: { id: string; email: string; hasPassword?: boolean } = {
  id: "u1",
  email: "writer@example.com",
};

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: "success", Error: "error" },
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  Redirect: () => null,
  useFocusEffect: () => {},
}));
jest.mock("../lib/use-stack-back", () => ({
  useStackBack: () => ({ backOr: jest.fn(), resetTo: mockResetTo }),
}));
jest.mock("../components/AppHeader", () => ({ AppHeader: () => null, useAppHeaderHeight: () => 0 }));
jest.mock("../lib/session", () => ({
  useSession: () => ({ user: mockUser, ready: true, deleteAccount: mockDeleteAccount }),
}));
jest.mock("../lib/use-export-account-data", () => ({
  useExportAccountData: () => ({ busy: false, run: mockRunExport }),
}));
jest.mock("../lib/api", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { ApiError, useEntitlementQuery: () => ({ data: undefined }) };
});

function renderScreen() {
  const colors = THEME_PALETTES.parchment;
  return render(
    <AppThemeContext.Provider
      value={{ settings: defaultSettings(), patch: jest.fn(), layout: makeLayout(colors), colors, dark: false }}
    >
      <DeleteAccountScreen />
    </AppThemeContext.Provider>
  );
}

function deleteButton() {
  return screen.getByRole("button", { name: "Delete account" });
}

describe("DeleteAccountScreen", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  beforeEach(() => {
    mockDeleteAccount.mockReset();
    mockResetTo.mockReset();
    mockUser = { id: "u1", email: "writer@example.com" };
  });

  it("says what is deleted, that it is permanent, and offers the export first", () => {
    renderScreen();
    expect(screen.getByText("This permanently deletes writer@example.com and everything in it:")).toBeTruthy();
    expect(screen.getByText("Every manuscript, with its chapters, snapshots and edit history")).toBeTruthy();
    expect(screen.getByText(/can't be undone/)).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Export my data" }));
    expect(mockRunExport).toHaveBeenCalled();
  });

  it("waits for the password, then deletes and leaves", async () => {
    mockDeleteAccount.mockResolvedValue(undefined);
    renderScreen();
    expect(deleteButton().props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText("Enter your password to confirm"), "hunter22");
    expect(deleteButton().props.accessibilityState.disabled).toBe(false);
    await act(async () => fireEvent.press(deleteButton()));
    expect(mockDeleteAccount).toHaveBeenCalledWith({ password: "hunter22" });
    expect(mockResetTo).toHaveBeenCalledWith("/");
  });

  it("shows why it failed and stays put", async () => {
    const { ApiError } = jest.requireMock("../lib/api") as { ApiError: new (m: string, s: number) => Error };
    mockDeleteAccount.mockRejectedValue(new ApiError("Incorrect password.", 403));
    renderScreen();
    fireEvent.changeText(screen.getByLabelText("Enter your password to confirm"), "wrong-one");
    await act(async () => fireEvent.press(deleteButton()));
    expect(screen.getByText("Incorrect password.")).toBeTruthy();
    expect(mockResetTo).not.toHaveBeenCalled();
  });

  it("asks an Apple / Google account without a password to type DELETE", async () => {
    mockUser = { id: "u1", email: "writer@icloud.com", hasPassword: false };
    mockDeleteAccount.mockResolvedValue(undefined);
    renderScreen();
    expect(screen.queryByLabelText("Enter your password to confirm")).toBeNull();
    const field = screen.getByLabelText("Type DELETE to confirm");
    fireEvent.changeText(field, "delet");
    expect(deleteButton().props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(field, "delete");
    expect(deleteButton().props.accessibilityState.disabled).toBe(false);
    await act(async () => fireEvent.press(deleteButton()));
    expect(mockDeleteAccount).toHaveBeenCalledWith({ confirmation: "delete" });
    expect(mockResetTo).toHaveBeenCalledWith("/");
  });
});
