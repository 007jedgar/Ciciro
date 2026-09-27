import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ScratchNotes } from "../components/ScratchNotes";
import {
  useCreateScratchNoteMutation,
  useDeleteScratchNoteMutation,
  useScratchNotesQuery,
} from "../lib/api";
import type { ScratchNote } from "../lib/api/types";

jest.mock("../lib/api", () => ({
  useScratchNotesQuery: jest.fn(),
  useCreateScratchNoteMutation: jest.fn(),
  useDeleteScratchNoteMutation: jest.fn(),
}));

const listMock = useScratchNotesQuery as jest.Mock;
const createMock = useCreateScratchNoteMutation as jest.Mock;
const deleteMock = useDeleteScratchNoteMutation as jest.Mock;

const NOTES: ScratchNote[] = [
  {
    id: "n2",
    projectId: "p1",
    title: "Tides",
    content: "Spring tides at the new moon",
    revision: 1,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "n1",
    projectId: "p1",
    title: "",
    content: "Names to use\nAda\nMara",
    revision: 0,
    createdAt: "",
    updatedAt: "",
  },
];

function mockApi(opts?: { notes?: ScratchNote[]; create?: jest.Mock; remove?: jest.Mock }) {
  listMock.mockReturnValue({
    data: opts?.notes ?? NOTES,
    isPending: false,
    isError: false,
  });
  createMock.mockReturnValue({
    mutateAsync: opts?.create ?? jest.fn(async () => ({ ...NOTES[1], id: "n3" })),
    isPending: false,
  });
  deleteMock.mockReturnValue({
    mutateAsync: opts?.remove ?? jest.fn(async () => ({ ok: true })),
    isPending: false,
  });
}

describe("ScratchNotes", () => {
  it("lists notes with a title and excerpt and opens one", () => {
    mockApi();
    const onOpen = jest.fn();
    render(<ScratchNotes projectId="p1" onOpen={onOpen} />);
    expect(screen.getByText("Tides")).toBeTruthy();
    expect(screen.getByText("Spring tides at the new moon")).toBeTruthy();
    // An untitled note is named by its first line.
    expect(screen.getByText("Names to use")).toBeTruthy();
    expect(screen.getByText("Ada Mara")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Open Tides"));
    expect(onOpen).toHaveBeenCalledWith("n2");
  });

  it("shows an empty state", () => {
    mockApi({ notes: [] });
    render(<ScratchNotes projectId="p1" onOpen={jest.fn()} />);
    expect(screen.getByText(/Nothing here yet/)).toBeTruthy();
  });

  it("adds a note and opens it", async () => {
    const create = jest.fn(async () => ({ ...NOTES[1], id: "n3" }));
    mockApi({ create });
    const onOpen = jest.fn();
    render(<ScratchNotes projectId="p1" onOpen={onOpen} />);
    fireEvent.press(screen.getByLabelText("New note"));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("n3"));
    expect(create).toHaveBeenCalledWith({ projectId: "p1" });
  });

  describe("deleting", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("slides the note out at once and only deletes after the undo window", async () => {
      const remove = jest.fn(async () => ({ ok: true }));
      mockApi({ remove });
      render(<ScratchNotes projectId="p1" onOpen={jest.fn()} />);
      fireEvent(screen.getByLabelText("Open Tides"), "longPress");

      expect(screen.queryByLabelText("Open Tides")).toBeNull();
      expect(screen.getByText("Note deleted")).toBeTruthy();
      expect(remove).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(6000);
      });
      expect(remove).toHaveBeenCalledWith({ projectId: "p1", noteId: "n2" });
      expect(screen.queryByText("Note deleted")).toBeNull();
    });

    it("brings the note back and never deletes it when Undo is tapped", async () => {
      const remove = jest.fn(async () => ({ ok: true }));
      mockApi({ remove });
      render(<ScratchNotes projectId="p1" onOpen={jest.fn()} />);
      fireEvent(screen.getByLabelText("Open Tides"), "longPress");
      fireEvent.press(screen.getByLabelText("Undo"));

      expect(screen.getByLabelText("Open Tides")).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(10000);
      });
      expect(remove).not.toHaveBeenCalled();
    });

    it("commits the first delete when a second one starts", async () => {
      const remove = jest.fn(async () => ({ ok: true }));
      mockApi({ remove });
      render(<ScratchNotes projectId="p1" onOpen={jest.fn()} />);
      fireEvent(screen.getByLabelText("Open Tides"), "longPress");
      fireEvent(screen.getByLabelText("Open Names to use"), "longPress");
      await act(async () => {});
      expect(remove).toHaveBeenCalledWith({ projectId: "p1", noteId: "n2" });
      expect(remove).toHaveBeenCalledTimes(1);
    });

    it("puts the note back and says why when the delete fails", async () => {
      const remove = jest.fn(async () => {
        throw new Error("offline");
      });
      mockApi({ remove });
      render(<ScratchNotes projectId="p1" onOpen={jest.fn()} />);
      fireEvent(screen.getByLabelText("Open Tides"), "longPress");
      await act(async () => {
        jest.advanceTimersByTime(6000);
      });
      expect(screen.getByLabelText("Open Tides")).toBeTruthy();
      expect(screen.getByText("Couldn't delete this note.")).toBeTruthy();
    });
  });
});
