import { Alert } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
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

  it("deletes a note after a confirm", async () => {
    const remove = jest.fn(async () => ({ ok: true }));
    mockApi({ remove });
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    render(<ScratchNotes projectId="p1" onOpen={jest.fn()} />);
    fireEvent(screen.getByLabelText("Open Tides"), "longPress");
    expect(alert).toHaveBeenCalledTimes(1);
    const buttons = alert.mock.calls[0][2]!;
    buttons.find((b) => b.style === "destructive")!.onPress!();
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ projectId: "p1", noteId: "n2" }));
  });
});
