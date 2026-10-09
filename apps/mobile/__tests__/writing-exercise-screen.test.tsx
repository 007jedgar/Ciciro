import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Alert, TextInput } from "react-native";
import WritingExerciseScreen from "../app/writing-exercise";

const mockLeave = jest.fn();
const mockReplace = jest.fn();
const mockKeep = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  Redirect: () => null,
}));
jest.mock("../lib/use-stack-back", () => ({ useStackBack: () => ({ backOr: mockLeave }) }));
jest.mock("../lib/session", () => ({ useSession: () => ({ user: { id: "u1", name: "Ana" }, ready: true }) }));
jest.mock("../lib/settings", () => ({
  useAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), settings: { reduceMotion: true, editorFont: "serif", editorFontSize: 18 } };
  },
  useOptionalAppTheme: () => ({ settings: { reduceMotion: true } }),
}));
jest.mock("../lib/writing-exercise-save", () => ({
  keepExerciseAsManuscript: (args: unknown) => mockKeep(args),
}));
jest.mock("../lib/new-manuscript-arrival", () => ({ markNewManuscriptArrival: jest.fn() }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));
// The native editor stands in as a plain text field: the screen only hears its text.
jest.mock("../components/ChapterEditor", () => {
  const { TextInput: Input } = jest.requireActual("react-native");
  return {
    ChapterEditor: ({ onChangeText, testID }: { onChangeText: (text: string) => void; testID: string }) => (
      <Input testID={testID} onChangeText={onChangeText} />
    ),
  };
});

async function writeThroughToFinish() {
  render(<WritingExerciseScreen />);
  fireEvent.press(screen.getByRole("button", { name: "Begin" }));
  expect(screen.getByText("Look around you.")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "I'm ready" }));
  for (const [text, next] of [
    ["Rain on the window.", "Next: React"],
    ["Calm, a little lonely.", "Next: Narrate"],
    ["Once, a girl waited out the storm.", "Finish"],
  ]) {
    fireEvent.changeText(screen.UNSAFE_getByType(TextInput), text);
    fireEvent.press(screen.getByRole("button", { name: next }));
  }
  expect(screen.getByText("Exercise complete")).toBeTruthy();
}

function pressLeaveInAlert() {
  const buttons = (jest.mocked(Alert.alert).mock.calls.at(-1)?.[2] ?? []) as { text: string; onPress?: () => void }[];
  buttons.find((b) => b.text === "Leave")?.onPress?.();
}

describe("Writing exercise screen", () => {
  beforeEach(() => {
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  it("walks intro, settle-in and the three parts, then shows all three texts on the finish", async () => {
    await writeThroughToFinish();
    expect(screen.getByText("Rain on the window.")).toBeTruthy();
    expect(screen.getByText("Calm, a little lonely.")).toBeTruthy();
    expect(screen.getByText("Once, a girl waited out the storm.")).toBeTruthy();
    expect(screen.getByText("15 words across three parts.")).toBeTruthy();
  });

  it("asks before leaving the finish when nothing was kept or copied", async () => {
    await writeThroughToFinish();
    fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(Alert.alert).toHaveBeenCalledWith("Leave the exercise?", expect.any(String), expect.any(Array));
    expect(mockLeave).not.toHaveBeenCalled();
    pressLeaveInAlert();
    expect(mockLeave).toHaveBeenCalledWith("/manuscripts");
  });

  it("leaves the finish straight away once the text was copied", async () => {
    await writeThroughToFinish();
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Copy text" })));
    fireEvent.press(screen.getByRole("button", { name: "Close the exercise" }));
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockLeave).toHaveBeenCalledTimes(1);
  });

  it("still asks after a Keep that made the manuscript but failed to save it, and the retry reuses that manuscript", async () => {
    const project = { id: "p1", isFirstProject: false, chapters: [{ id: "c1", revision: 1 }] };
    mockKeep.mockImplementationOnce(async ({ onCreated }: { onCreated: (p: typeof project) => void }) => {
      onCreated(project);
      throw new Error("network");
    });
    await writeThroughToFinish();
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Keep as a manuscript" })));
    expect(screen.getByText("Could not save your writing. Try again.")).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(mockLeave).not.toHaveBeenCalled();

    mockKeep.mockImplementationOnce(async () => project);
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Keep as a manuscript" })));
    expect(mockKeep.mock.calls[1][0]).toMatchObject({ existing: project });
    expect(mockReplace).toHaveBeenCalledWith("/project/p1/chapters");
  });

  it("asks before closing a writing part that has text", async () => {
    render(<WritingExerciseScreen />);
    fireEvent.press(screen.getByRole("button", { name: "Begin" }));
    fireEvent.press(screen.getByRole("button", { name: "I'm ready" }));
    fireEvent.changeText(screen.UNSAFE_getByType(TextInput), "A dog barks.");
    fireEvent.press(screen.getByRole("button", { name: "Close the exercise" }));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(mockLeave).not.toHaveBeenCalled();
  });
});
