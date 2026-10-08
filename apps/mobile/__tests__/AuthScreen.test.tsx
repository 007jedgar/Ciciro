import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "i18next";
import { AuthScreen } from "../components/AuthScreen";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import { useAuthFormStore } from "../lib/auth-form-store";
import "../lib/i18n";
import { makeLayout, THEME_PALETTES } from "../lib/theme";

const mockLogin = jest.fn();
const mockSignup = jest.fn();

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success", Error: "error", Warning: "warning" },
}));
jest.mock("expo-blur", () => ({ BlurView: ({ children }: { children?: unknown }) => children ?? null }));
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 40, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../lib/use-stack-back", () => ({ useStackBack: () => ({ backOr: jest.fn() }) }));
jest.mock("../components/SocialSignIn", () => ({ SocialSignIn: () => null }));
jest.mock("../lib/last-place", () => ({ restoreLastPlace: jest.fn() }));
jest.mock("../lib/onboarding-answers", () => ({ saveOnboardingAnswers: jest.fn() }));
jest.mock("../lib/session", () => ({
  useSession: () => ({ login: mockLogin, signup: mockSignup }),
}));

function renderScreen() {
  const settings = defaultSettings();
  const colors = THEME_PALETTES[settings.theme];
  return render(
    <AppThemeContext.Provider
      value={{ settings, colors, layout: makeLayout(colors, settings.editorFont), dark: false, patch: jest.fn() }}
    >
      <AuthScreen initialMode="login" />
    </AppThemeContext.Provider>
  );
}

describe("Sign in from the keyboard", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  beforeEach(() => {
    useAuthFormStore.getState().reset();
    mockLogin.mockReset();
    mockSignup.mockReset();
  });

  it("signs in once when Return is pressed again while the first sign-in is in flight", async () => {
    let finish: (user: { id: string }) => void = () => {};
    mockLogin.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    renderScreen();
    fireEvent.changeText(screen.getByLabelText("Email"), "ada@example.com");
    fireEvent.changeText(screen.getByLabelText("Password"), "correct horse battery");

    const password = screen.getByLabelText("Password");
    await act(async () => {
      fireEvent(password, "submitEditing");
    });
    await act(async () => {
      fireEvent(password, "submitEditing");
    });

    expect(mockLogin).toHaveBeenCalledTimes(1);
    expect(mockLogin).toHaveBeenCalledWith("ada@example.com", "correct horse battery");

    await act(async () => {
      finish({ id: "u1" });
    });
  });

  it("lets the author retry from Return after a failed sign-in", async () => {
    const { ApiError } = jest.requireActual("../lib/api");
    mockLogin.mockRejectedValueOnce(new ApiError("Wrong email or password.", 401));
    mockLogin.mockResolvedValueOnce({ id: "u1" });
    renderScreen();
    fireEvent.changeText(screen.getByLabelText("Email"), "ada@example.com");
    fireEvent.changeText(screen.getByLabelText("Password"), "correct horse battery");

    const password = screen.getByLabelText("Password");
    await act(async () => {
      fireEvent(password, "submitEditing");
    });
    await act(async () => {
      fireEvent(password, "submitEditing");
    });
    expect(mockLogin).toHaveBeenCalledTimes(2);
  });
});
