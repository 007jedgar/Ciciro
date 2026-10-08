import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "i18next";
import { AuthScreen } from "../components/AuthScreen";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import { ThemePreviewContext } from "../lib/theme-preview-context";
import { onboardingReminderDraft, type OnboardingState } from "../lib/onboarding-flow";
import { useAuthFormStore } from "../lib/auth-form-store";
import "../lib/i18n";
import { makeLayout, THEME_PALETTES, type ThemeId } from "../lib/theme";

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
let mockSocialSignedIn: (user: { id: string }, created: boolean) => void = () => {};
jest.mock("../components/SocialSignIn", () => ({
  SocialSignIn: ({ onSignedIn }: { onSignedIn: typeof mockSocialSignedIn }) => {
    mockSocialSignedIn = onSignedIn;
    return null;
  },
}));
jest.mock("../lib/last-place", () => ({ restoreLastPlace: jest.fn() }));
const mockSaveAnswers = jest.fn();
const mockCommitReminders = jest.fn();
jest.mock("../lib/onboarding-answers", () => ({ saveOnboardingAnswers: (...args: unknown[]) => mockSaveAnswers(...args) }));
jest.mock("../lib/writing-reminder-store", () => ({
  commitWritingReminders: (...args: unknown[]) => mockCommitReminders(...args),
}));
jest.mock("../lib/session", () => ({
  useSession: () => ({ login: mockLogin, signup: mockSignup }),
}));

const mockSetPreview = jest.fn();
const mockAdoptPreview = jest.fn();

function renderOnboardingSignup(onboarding: OnboardingState, preview: ThemeId | null = "ember") {
  const settings = defaultSettings();
  const colors = THEME_PALETTES[settings.theme];
  return render(
    <ThemePreviewContext.Provider
      value={{ preview, setPreview: mockSetPreview, adoptPreview: mockAdoptPreview }}
    >
      <AppThemeContext.Provider
        value={{ settings, colors, layout: makeLayout(colors, settings.editorFont), dark: false, patch: jest.fn() }}
      >
        <AuthScreen initialMode="signup" onboarding={onboarding} />
      </AppThemeContext.Provider>
    </ThemePreviewContext.Provider>
  );
}

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

describe("Signing up from the onboarding", () => {
  const reminder = onboardingReminderDraft("wr_onboarding");
  const quiz: OnboardingState = { kind: "novel", obstacles: ["consistency"], reminder };

  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  beforeEach(() => {
    useAuthFormStore.getState().reset();
    mockSignup.mockReset();
    mockSaveAnswers.mockReset();
    mockCommitReminders.mockReset();
    mockSetPreview.mockReset();
    mockAdoptPreview.mockReset();
  });

  async function submitSignup() {
    renderOnboardingSignup(quiz);
    fireEvent.changeText(screen.getByLabelText("Email"), "ada@example.com");
    fireEvent.changeText(screen.getByLabelText("Password"), "correct horse battery");
    await act(async () => {
      fireEvent(screen.getByLabelText("Password"), "submitEditing");
    });
  }

  it("gives the new account its answers, its previewed theme and its reminder", async () => {
    mockSignup.mockResolvedValueOnce({ id: "u-new" });
    await submitSignup();
    expect(mockSaveAnswers).toHaveBeenCalledWith("novel", ["consistency"]);
    expect(mockAdoptPreview).toHaveBeenCalledTimes(1);
    expect(mockCommitReminders).toHaveBeenCalledWith("u-new", [reminder]);
    expect(mockSetPreview).not.toHaveBeenCalled();
  });

  it("keeps an existing account's own theme and reminders when a social sign-in lands on it", async () => {
    renderOnboardingSignup(quiz);
    await act(async () => {
      mockSocialSignedIn({ id: "u-old" }, false);
    });
    expect(mockSetPreview).toHaveBeenCalledWith(null);
    expect(mockAdoptPreview).not.toHaveBeenCalled();
    expect(mockCommitReminders).not.toHaveBeenCalled();
  });

  it("gives a brand-new social account the theme and reminder too", async () => {
    renderOnboardingSignup(quiz);
    await act(async () => {
      mockSocialSignedIn({ id: "u-social" }, true);
    });
    expect(mockAdoptPreview).toHaveBeenCalledTimes(1);
    expect(mockCommitReminders).toHaveBeenCalledWith("u-social", [reminder]);
  });

  it("saves nothing to the account when the sign-up fails", async () => {
    const { ApiError } = jest.requireActual("../lib/api");
    mockSignup.mockRejectedValueOnce(new ApiError("That email is already registered.", 409));
    await submitSignup();
    expect(mockSaveAnswers).not.toHaveBeenCalled();
    expect(mockAdoptPreview).not.toHaveBeenCalled();
    expect(mockCommitReminders).not.toHaveBeenCalled();
  });
});
