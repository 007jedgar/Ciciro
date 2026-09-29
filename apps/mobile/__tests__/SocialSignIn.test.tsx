import { Platform } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SocialSignIn } from "../components/SocialSignIn";
import { SocialSignInError } from "../lib/social-auth";

const mockSignInWithBrowser = jest.fn();
const mockSignInWithApple = jest.fn();
let mockProviders: unknown = undefined;

jest.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  useAuthProvidersQuery: () => ({ data: mockProviders }),
}));
jest.mock("../lib/session", () => ({
  useSession: () => ({ signInWithApple: mockSignInWithApple, signInWithBrowser: mockSignInWithBrowser }),
}));
jest.mock("../lib/settings", () => ({
  useAppTheme: () => ({ colors: jest.requireActual("../lib/theme").colors, dark: false }),
}));
jest.mock("../lib/social-sign-in", () => ({
  appleSheetAvailable: async () => false,
}));
jest.mock("expo-apple-authentication", () => ({
  AppleAuthenticationButton: () => null,
  AppleAuthenticationButtonType: { CONTINUE: 1 },
  AppleAuthenticationButtonStyle: { BLACK: 2, WHITE: 0 },
}));

function renderButtons() {
  const props = {
    disabled: false,
    onBusyChange: jest.fn(),
    onError: jest.fn(),
    onSignedIn: jest.fn(),
  };
  render(<SocialSignIn {...props} />);
  return props;
}

describe("SocialSignIn", () => {
  const os = Platform.OS;
  beforeEach(() => {
    mockProviders = { apple: { web: true, native: true }, google: true };
    Platform.OS = "android";
  });
  afterEach(() => {
    Platform.OS = os;
  });

  it("renders nothing when the server has no providers configured", () => {
    mockProviders = undefined;
    renderButtons();
    expect(screen.queryByLabelText("Continue with Google")).toBeNull();
    expect(screen.queryByText("or")).toBeNull();
  });

  it("signs in with Google through the browser flow", async () => {
    const user = { id: "u1", email: "a@gmail.com", name: "" };
    mockSignInWithBrowser.mockResolvedValueOnce(user);
    const props = renderButtons();
    fireEvent.press(screen.getByLabelText("Continue with Google"));
    await waitFor(() => expect(props.onSignedIn).toHaveBeenCalledWith(user));
    expect(mockSignInWithBrowser).toHaveBeenCalledWith("google");
    expect(props.onBusyChange).toHaveBeenCalledWith(true);
  });

  it("offers Apple through the browser on Android", async () => {
    mockSignInWithBrowser.mockResolvedValueOnce(null);
    const props = renderButtons();
    fireEvent.press(screen.getByLabelText("Continue with Apple"));
    // Backing out is not an error; the form just becomes usable again.
    await waitFor(() => expect(props.onBusyChange).toHaveBeenLastCalledWith(false));
    expect(mockSignInWithBrowser).toHaveBeenCalledWith("apple");
    expect(props.onError).toHaveBeenLastCalledWith(null);
    expect(props.onSignedIn).not.toHaveBeenCalled();
  });

  it("shows the server's reason when a sign-in is refused", async () => {
    mockSignInWithBrowser.mockRejectedValueOnce(new SocialSignInError("unverified_email"));
    const props = renderButtons();
    fireEvent.press(screen.getByLabelText("Continue with Google"));
    await waitFor(() =>
      expect(props.onError).toHaveBeenLastCalledWith(
        "Verify your email address with the provider, then try again."
      )
    );
    expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
  });
});
