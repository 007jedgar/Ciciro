import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ManuscriptSearch } from "../components/ManuscriptSearch";
import { ciciro } from "../lib/api";

jest.mock("expo-file-system", () => ({ File: jest.fn(), Paths: {} }));
jest.mock("expo-sharing", () => ({}));
const mockFlushEdits = jest.fn(async () => true);
const mockReload = jest.fn();
jest.mock("../lib/project", () => ({ useProject: () => ({ flushEdits: mockFlushEdits, reload: mockReload }) }));
jest.mock("../lib/settings", () => ({
  useAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), settings: { autoCorrect: true } };
  },
}));

const found = {
  total: 1,
  chapters: 1,
  truncated: false,
  matches: [
    {
      chapterId: "c1",
      chapterTitle: "Opening",
      chapterNumber: 1,
      blockId: "b1",
      occurrence: 0,
      offset: 4,
      before: "Meet ",
      match: "Jon",
      after: " today",
    },
  ],
};

describe("ManuscriptSearch", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function search() {
    jest.spyOn(ciciro.search, "find").mockResolvedValue(found);
    const onJump = jest.fn();
    render(<ManuscriptSearch projectId="p1" onJump={onJump} />);
    fireEvent.changeText(screen.getByLabelText("Find in every chapter"), "jon");
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    return onJump;
  }

  it("lists matches with context and jumps to one", async () => {
    const onJump = await search();
    expect(await screen.findByText("1 match in 1 chapters")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Go to this match in Opening"));
    expect(onJump).toHaveBeenCalledWith(found.matches[0]);
  });

  it("replaces one match and reloads the project", async () => {
    await search();
    const replace = jest.spyOn(ciciro.search, "replace").mockResolvedValue({ replaced: 1, chapters: [] });
    fireEvent.changeText(screen.getByLabelText("Replace with"), "Ann");
    await screen.findByText("1 match in 1 chapters");
    fireEvent.press(screen.getByLabelText("Replace"));
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace.mock.calls[0][1]).toMatchObject({
      query: "jon",
      replacement: "Ann",
      target: { chapterId: "c1", blockId: "b1", occurrence: 0 },
    });
    expect(mockFlushEdits).toHaveBeenCalled();
    await waitFor(() => expect(mockReload).toHaveBeenCalled());
  });
});
