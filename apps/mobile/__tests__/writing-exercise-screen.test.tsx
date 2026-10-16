import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Alert, BackHandler, TextInput } from "react-native";
import WritingExerciseScreen from "../app/writing-exercise";
import { EXERCISES } from "../lib/writing-exercise";

const mockLeave = jest.fn();
const mockReplace = jest.fn();
const mockKeep = jest.fn();
const mockTrack = jest.fn();
let mockParams: { id?: string } = {};

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => mockParams,
  Redirect: () => null,
}));
jest.mock("../lib/use-stack-back", () => ({ useStackBack: () => ({ backOr: mockLeave }) }));
jest.mock("../lib/session", () => ({ useSession: () => ({ user: { id: "u1", name: "Ana" }, ready: true }) }));
jest.mock("../lib/analytics-client", () => ({ getAnalytics: () => ({ track: mockTrack }) }));
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

function pick(id: string) {
  fireEvent.press(screen.getByTestId(`exercise-card-${id}`));
}

function write(text: string) {
  fireEvent.changeText(screen.UNSAFE_getByType(TextInput), text);
}

async function writeThroughToFinish() {
  render(<WritingExerciseScreen />);
  pick("observe_react_narrate");
  fireEvent.press(screen.getByRole("button", { name: "Begin" }));
  expect(screen.getByText("Look around you.")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "I'm ready" }));
  for (const [text, next] of [
    ["Rain on the window.", "Next: React"],
    ["Calm, a little lonely.", "Next: Narrate"],
    ["Once, a girl waited out the storm.", "Finish"],
  ]) {
    write(text);
    fireEvent.press(screen.getByRole("button", { name: next }));
  }
  expect(screen.getByText("Exercise complete")).toBeTruthy();
}

function pressHardwareBack() {
  const handlers = jest.mocked(BackHandler.addEventListener).mock.calls
    .filter(([event]) => event === "hardwareBackPress")
    .map(([, handler]) => handler);
  act(() => {
    handlers.at(-1)?.();
  });
}

function pressLeaveInAlert() {
  const buttons = (jest.mocked(Alert.alert).mock.calls.at(-1)?.[2] ?? []) as { text: string; onPress?: () => void }[];
  buttons.find((b) => b.text === "Leave")?.onPress?.();
}

describe("Writing exercise screen", () => {
  beforeEach(() => {
    mockParams = {};
    jest.clearAllMocks();
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
    jest.spyOn(BackHandler, "addEventListener");
  });

  it("opens on the list of exercises, each with what it is for and how long it takes", () => {
    render(<WritingExerciseScreen />);
    expect(screen.getByText("Writing exercises")).toBeTruthy();
    for (const exercise of EXERCISES) expect(screen.getByTestId(`exercise-card-${exercise.id}`)).toBeTruthy();
    expect(screen.getByText("Pour it out")).toBeTruthy();
    expect(screen.getByText("One true sentence")).toBeTruthy();
    expect(screen.getByText("The terrible first draft")).toBeTruthy();
    expect(screen.getByText("A list of nouns")).toBeTruthy();
    expect(screen.getByText("ABOUT 10 MIN, 1 PART")).toBeTruthy();
    expect(screen.getByText("ABOUT 9 MIN, 3 PARTS")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Begin" })).toBeNull();
  });

  it("opens an exercise's intro from its card, and goes back to the list from there", () => {
    render(<WritingExerciseScreen />);
    pick("one_true_sentence");
    expect(screen.getByText("One true sentence")).toBeTruthy();
    expect(screen.getByText("A way back in")).toBeTruthy();
    expect(screen.getByText(/About 9 minutes in all/)).toBeTruthy();
    expect(screen.getByText(/A Moveable Feast/)).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "All exercises" }));
    expect(screen.getByText("Writing exercises")).toBeTruthy();
    expect(screen.getByTestId("exercise-card-noun_list")).toBeTruthy();
  });

  it("goes back to the list on the hardware back from an intro, rather than leaving", () => {
    render(<WritingExerciseScreen />);
    pick("one_true_sentence");
    expect(screen.getByRole("button", { name: "Begin" })).toBeTruthy();

    pressHardwareBack();
    expect(screen.getByText("Writing exercises")).toBeTruthy();
    expect(screen.getByTestId("exercise-card-noun_list")).toBeTruthy();
    expect(mockLeave).not.toHaveBeenCalled();

    pressHardwareBack();
    expect(mockLeave).toHaveBeenCalledWith("/manuscripts");
  });

  it("skips the list when the link names an exercise, and still offers the way back", () => {
    mockParams = { id: "noun_list" };
    render(<WritingExerciseScreen />);
    expect(screen.getByText("A list of nouns")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Begin" })).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "All exercises" }));
    expect(screen.getByTestId("exercise-card-pour_it_out")).toBeTruthy();
  });

  it("falls back to the list for a link naming an exercise that does not exist", () => {
    mockParams = { id: "nope" };
    render(<WritingExerciseScreen />);
    expect(screen.getByTestId("exercise-card-pour_it_out")).toBeTruthy();
  });

  it("walks intro, settle-in and the three parts, then shows all three texts on the finish", async () => {
    await writeThroughToFinish();
    expect(screen.getByText("Rain on the window.")).toBeTruthy();
    expect(screen.getByText("Calm, a little lonely.")).toBeTruthy();
    expect(screen.getByText("Once, a girl waited out the storm.")).toBeTruthy();
    expect(screen.getByText("15 words written.")).toBeTruthy();
  });

  it("tracks the exercise it ran by id", async () => {
    await writeThroughToFinish();
    expect(mockTrack).toHaveBeenCalledWith("writing_exercise_started", { exercise: "observe_react_narrate" });
    expect(mockTrack).toHaveBeenCalledWith("writing_exercise_completed", {
      exercise: "observe_react_narrate",
      durationMinutes: 1,
    });
  });

  it("runs a single page with its own settle-in, ends on Finish, and names no part on the finish", async () => {
    render(<WritingExerciseScreen />);
    pick("pour_it_out");
    fireEvent.press(screen.getByRole("button", { name: "Begin" }));
    expect(screen.getByText("Take one slow breath out.")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "I'm ready" }));

    expect(screen.getByText("Keep going. Don't stop to fix or reread. If you are stuck, write that down.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finish" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Next/ })).toBeNull();
    write("Rain again.\nA kettle.");
    fireEvent.press(screen.getByRole("button", { name: "Finish" }));

    expect(screen.getByText("Exercise complete")).toBeTruthy();
    expect(screen.getByText("Rain again.")).toBeTruthy();
    expect(screen.getByText("4 words written.")).toBeTruthy();
    expect(screen.queryByText("YOUR PAGES")).toBeNull();
    expect(mockTrack).toHaveBeenCalledWith("writing_exercise_completed", expect.objectContaining({ exercise: "pour_it_out" }));
  });

  it("goes straight to the page for an exercise with no settle-in, and walks its parts in order", () => {
    render(<WritingExerciseScreen />);
    pick("one_true_sentence");
    fireEvent.press(screen.getByRole("button", { name: "Begin" }));
    expect(screen.getByText("Write one true sentence. The truest one you know, as plainly as you can.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "I'm ready" })).toBeNull();
    expect(screen.getByText("ONE SENTENCE  1 / 3")).toBeTruthy();

    write("The kettle is cold.");
    fireEvent.press(screen.getByRole("button", { name: "Next: The next ones" }));
    expect(screen.getByText("THE NEXT ONES  2 / 3")).toBeTruthy();
    // What was written before stays in view above the page.
    expect(screen.getByText("The kettle is cold.")).toBeTruthy();

    write("My coat is wet.");
    fireEvent.press(screen.getByRole("button", { name: "Next: A way back in" }));
    expect(screen.getByText("A WAY BACK IN  3 / 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finish" })).toBeTruthy();
  });

  it("keeps the nouns just listed in view above the page that asks you to write about one", () => {
    render(<WritingExerciseScreen />);
    pick("noun_list");
    fireEvent.press(screen.getByRole("button", { name: "Begin" }));
    write("the attic\na red coat");
    fireEvent.press(screen.getByRole("button", { name: "Next: The pull" }));
    expect(screen.getByText("the attic")).toBeTruthy();
    expect(screen.getByText("a red coat")).toBeTruthy();
    expect(screen.getByText("Pick the noun with the strongest pull. Write about it: a memory, an essay, a story, whatever it wants to be.")).toBeTruthy();
  });

  it("asks before leaving the finish when nothing was kept or copied", async () => {
    await writeThroughToFinish();
    fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(Alert.alert).toHaveBeenCalledWith("Leave the exercise?", expect.any(String), expect.any(Array));
    expect(mockLeave).not.toHaveBeenCalled();
    pressLeaveInAlert();
    expect(mockLeave).toHaveBeenCalledWith("/manuscripts");
  });

  it("leaves the list without asking, since nothing is written yet", () => {
    render(<WritingExerciseScreen />);
    fireEvent.press(screen.getByRole("button", { name: "Close the exercise" }));
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockLeave).toHaveBeenCalledWith("/manuscripts");
  });

  it("leaves the finish straight away once the text was copied", async () => {
    await writeThroughToFinish();
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Copy text" })));
    fireEvent.press(screen.getByRole("button", { name: "Close the exercise" }));
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockLeave).toHaveBeenCalledTimes(1);
  });

  it("keeps the exercise it ran, titled by name and date", async () => {
    const project = { id: "p9", isFirstProject: false, chapters: [{ id: "c1", revision: 1 }] };
    mockKeep.mockImplementationOnce(async () => project);
    render(<WritingExerciseScreen />);
    pick("terrible_first_draft");
    fireEvent.press(screen.getByRole("button", { name: "Begin" }));
    write("It was a dark and stormy night, and she was sad.");
    fireEvent.press(screen.getByRole("button", { name: "Next: Find a keeper" }));
    write("The night ate the lamp.");
    fireEvent.press(screen.getByRole("button", { name: "Finish" }));
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Keep as a manuscript" })));

    expect(mockKeep).toHaveBeenCalledTimes(1);
    expect(mockKeep.mock.calls[0][0]).toMatchObject({
      exercise: { id: "terrible_first_draft" },
      texts: {
        terrible: "It was a dark and stormy night, and she was sad.",
        keeper: "The night ate the lamp.",
      },
      labels: { terrible: "The terrible draft", keeper: "The keeper" },
      title: expect.stringMatching(/^The terrible first draft, /),
    });
    expect(mockReplace).toHaveBeenCalledWith("/project/p9/chapters");
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
    pick("observe_react_narrate");
    fireEvent.press(screen.getByRole("button", { name: "Begin" }));
    fireEvent.press(screen.getByRole("button", { name: "I'm ready" }));
    write("A dog barks.");
    fireEvent.press(screen.getByRole("button", { name: "Close the exercise" }));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(mockLeave).not.toHaveBeenCalled();
  });
});
