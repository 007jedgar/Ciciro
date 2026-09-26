import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ScratchNoteEditor } from "../components/ScratchNoteEditor";
import { useScratchNotesQuery, useUpdateScratchNoteMutation } from "../lib/api";
import { ApiError } from "../lib/api/client";
import type { ScratchNote } from "../lib/api/types";
import { SCRATCH_SAVE_DELAY_MS } from "../lib/scratch";

jest.mock("../lib/api", () => ({
  useScratchNotesQuery: jest.fn(),
  useUpdateScratchNoteMutation: jest.fn(),
}));

const listMock = useScratchNotesQuery as jest.Mock;
const updateMock = useUpdateScratchNoteMutation as jest.Mock;

function note(over: Partial<ScratchNote> = {}): ScratchNote {
  return {
    id: "n1",
    projectId: "p1",
    title: "Tides",
    content: "moon",
    revision: 2,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function mockApi(current: ScratchNote, mutateAsync: jest.Mock) {
  listMock.mockReturnValue({ data: [current], isPending: false, isError: false });
  updateMock.mockReturnValue({ mutateAsync, isPending: false });
}

describe("ScratchNoteEditor", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("loads the note and saves typing after a pause against the revision it read", async () => {
    const save = jest.fn(async (vars: { body: { content: string } }) =>
      note({ content: vars.body.content, revision: 3 })
    );
    mockApi(note(), save);
    render(<ScratchNoteEditor projectId="p1" noteId="n1" />);
    expect(screen.getByDisplayValue("Tides")).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Note text"), "moons");
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(SCRATCH_SAVE_DELAY_MS + 10);
    });
    expect(save).toHaveBeenCalledWith({
      projectId: "p1",
      noteId: "n1",
      body: { title: "Tides", content: "moons", expectedRevision: 2 },
    });
  });

  it("offers the other device's version when a save is refused", async () => {
    const theirs = note({ content: "their words", revision: 3 });
    const save = jest.fn(async () => {
      throw new ApiError("changed", 409, { error: "changed", currentRevision: 3, note: theirs });
    });
    mockApi(note(), save);
    render(<ScratchNoteEditor projectId="p1" noteId="n1" />);
    fireEvent.changeText(screen.getByLabelText("Note text"), "my words");
    await act(async () => {
      jest.advanceTimersByTime(SCRATCH_SAVE_DELAY_MS + 10);
    });
    expect(screen.getByText("Changed on another device")).toBeTruthy();
    // No retry loop while the choice is open.
    await act(async () => {
      jest.advanceTimersByTime(SCRATCH_SAVE_DELAY_MS * 3);
    });
    expect(save).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByLabelText("Use that version"));
    expect(screen.getByDisplayValue("their words")).toBeTruthy();
    expect(screen.queryByText("Changed on another device")).toBeNull();
  });

  it("keeps my version by saving it over the current revision", async () => {
    const theirs = note({ content: "their words", revision: 3 });
    const save = jest
      .fn()
      .mockRejectedValueOnce(
        new ApiError("changed", 409, { error: "changed", currentRevision: 3, note: theirs })
      )
      .mockResolvedValue(note({ content: "my words", revision: 4 }));
    mockApi(note(), save);
    render(<ScratchNoteEditor projectId="p1" noteId="n1" />);
    fireEvent.changeText(screen.getByLabelText("Note text"), "my words");
    await act(async () => {
      jest.advanceTimersByTime(SCRATCH_SAVE_DELAY_MS + 10);
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Keep mine"));
    });
    expect(save).toHaveBeenLastCalledWith({
      projectId: "p1",
      noteId: "n1",
      body: { title: "Tides", content: "my words", expectedRevision: 3 },
    });
    expect(screen.queryByText("Changed on another device")).toBeNull();
  });

  it("picks up an edit from another device when there is nothing unsaved", () => {
    mockApi(note(), jest.fn());
    const { rerender } = render(<ScratchNoteEditor projectId="p1" noteId="n1" />);
    listMock.mockReturnValue({
      data: [note({ content: "from the web", revision: 3 })],
      isPending: false,
      isError: false,
    });
    rerender(<ScratchNoteEditor projectId="p1" noteId="n1" />);
    expect(screen.getByDisplayValue("from the web")).toBeTruthy();
  });

  it("keeps unsaved typing when another device's edit arrives", () => {
    mockApi(note(), jest.fn());
    const { rerender } = render(<ScratchNoteEditor projectId="p1" noteId="n1" />);
    fireEvent.changeText(screen.getByLabelText("Note text"), "mine");
    listMock.mockReturnValue({
      data: [note({ content: "from the web", revision: 3 })],
      isPending: false,
      isError: false,
    });
    rerender(<ScratchNoteEditor projectId="p1" noteId="n1" />);
    expect(screen.getByDisplayValue("mine")).toBeTruthy();
  });

  it("ignores a refresh that is older than its own last save", async () => {
    const save = jest
      .fn()
      .mockResolvedValueOnce(note({ content: "moons", revision: 3 }))
      .mockResolvedValue(note({ content: "moons!", revision: 4 }));
    mockApi(note(), save);
    const { rerender } = render(<ScratchNoteEditor projectId="p1" noteId="n1" />);
    fireEvent.changeText(screen.getByLabelText("Note text"), "moons");
    await act(async () => {
      jest.advanceTimersByTime(SCRATCH_SAVE_DELAY_MS + 10);
    });
    rerender(<ScratchNoteEditor projectId="p1" noteId="n1" />);
    expect(screen.getByDisplayValue("moons")).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Note text"), "moons!");
    await act(async () => {
      jest.advanceTimersByTime(SCRATCH_SAVE_DELAY_MS + 10);
    });
    expect(save).toHaveBeenLastCalledWith({
      projectId: "p1",
      noteId: "n1",
      body: { title: "Tides", content: "moons!", expectedRevision: 3 },
    });
  });

  it("says so when the note is gone", () => {
    listMock.mockReturnValue({ data: [], isPending: false, isError: false });
    updateMock.mockReturnValue({ mutateAsync: jest.fn(), isPending: false });
    render(<ScratchNoteEditor projectId="p1" noteId="n1" />);
    expect(screen.getByText("This note no longer exists.")).toBeTruthy();
  });
});
