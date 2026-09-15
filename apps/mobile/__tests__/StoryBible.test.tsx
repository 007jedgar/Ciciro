import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { StoryBibleIndex } from "../components/StoryBibleIndex";
import { StoryBibleEditor } from "../components/StoryBibleEditor";
import {
  useBibleFileQuery,
  useBibleIndexQuery,
  useCreateBibleCharacterMutation,
  useCreateBiblePlotMutation,
  useWriteBibleMutation,
} from "../lib/api";

jest.mock("../lib/use-reduce-motion", () => ({
  useReduceMotion: () => false,
}));

jest.mock("../lib/api", () => ({
  useBibleIndexQuery: jest.fn(),
  useBibleFileQuery: jest.fn(),
  useWriteBibleMutation: jest.fn(),
  useCreateBibleCharacterMutation: jest.fn(),
  useCreateBiblePlotMutation: jest.fn(),
}));

const useBibleIndexQueryMock = useBibleIndexQuery as jest.MockedFunction<typeof useBibleIndexQuery>;
const useBibleFileQueryMock = useBibleFileQuery as jest.MockedFunction<typeof useBibleFileQuery>;
const useWriteBibleMutationMock = useWriteBibleMutation as jest.MockedFunction<
  typeof useWriteBibleMutation
>;
const useCreateBibleCharacterMutationMock =
  useCreateBibleCharacterMutation as jest.MockedFunction<typeof useCreateBibleCharacterMutation>;
const useCreateBiblePlotMutationMock = useCreateBiblePlotMutation as jest.MockedFunction<
  typeof useCreateBiblePlotMutation
>;

function mockIndex(options?: {
  entries?: { path: string; summary: string }[];
  createCharacter?: jest.Mock;
  createPlot?: jest.Mock;
}) {
  useBibleIndexQueryMock.mockReturnValue({
    data: options?.entries ?? [
      { path: "canon.md", summary: "Hard facts" },
      { path: "world.md", summary: "Settings and lore" },
      { path: "characters/ada.md", summary: "A mathematician" },
    ],
    isPending: false,
    isError: false,
  } as never);
  useCreateBibleCharacterMutationMock.mockReturnValue({
    mutateAsync:
      options?.createCharacter ??
      jest.fn(async () => ({ path: "characters/mara.md", content: "# Mara\n", revision: 0 })),
    isPending: false,
  } as never);
  useCreateBiblePlotMutationMock.mockReturnValue({
    mutateAsync:
      options?.createPlot ??
      jest.fn(async () => ({ path: "plot/the-heist.md", content: "# The heist\n", revision: 0 })),
    isPending: false,
  } as never);
}

describe("StoryBibleIndex", () => {
  it("shows the starter files even when the server omits some of them", () => {
    mockIndex();
    const { unmount } = render(<StoryBibleIndex projectId="p1" onOpenFile={jest.fn()} />);
    expect(screen.getByLabelText("Open Canon")).toBeTruthy();
    expect(screen.getByLabelText("Open Plot")).toBeTruthy();
    expect(screen.getByLabelText("Open Style")).toBeTruthy();
    expect(screen.getByLabelText("Open Timeline")).toBeTruthy();
    expect(screen.getByLabelText("Open World")).toBeTruthy();
    expect(screen.getByLabelText("Open Ada")).toBeTruthy();
    unmount();
  });

  it("opens a file from the list", () => {
    mockIndex();
    const onOpenFile = jest.fn();
    const { unmount } = render(<StoryBibleIndex projectId="p1" onOpenFile={onOpenFile} />);
    fireEvent.press(screen.getByLabelText("Open Canon"));
    expect(onOpenFile).toHaveBeenCalledWith("canon.md");
    unmount();
  });

  it("creates a character and a plot line, then opens them", async () => {
    const createCharacter = jest.fn(async () => ({
      path: "characters/mara.md",
      content: "# Mara\n",
      revision: 0,
    }));
    const createPlot = jest.fn(async () => ({
      path: "plot/the-heist.md",
      content: "# The heist\n",
      revision: 0,
    }));
    mockIndex({ createCharacter, createPlot });
    const onOpenFile = jest.fn();
    const { unmount } = render(<StoryBibleIndex projectId="p1" onOpenFile={onOpenFile} />);

    fireEvent.changeText(screen.getByLabelText("New character name"), "Mara");
    fireEvent.press(screen.getByLabelText("Add character"));
    await waitFor(() =>
      expect(createCharacter).toHaveBeenCalledWith({ projectId: "p1", newCharacter: "Mara" })
    );
    expect(onOpenFile).toHaveBeenCalledWith("characters/mara.md");

    fireEvent.changeText(screen.getByLabelText("New plot line"), "The heist");
    fireEvent.press(screen.getByLabelText("Add plot line"));
    await waitFor(() =>
      expect(createPlot).toHaveBeenCalledWith({ projectId: "p1", newPlot: "The heist" })
    );
    expect(onOpenFile).toHaveBeenCalledWith("plot/the-heist.md");
    unmount();
  });
});

describe("StoryBibleEditor", () => {
  it("loads a file and saves edits", async () => {
    const write = jest.fn(async () => ({ ok: true as const, path: "canon.md", revision: 1 }));
    useBibleFileQueryMock.mockReturnValue({
      data: { path: "canon.md", content: "# Canon\nHard facts.\n", revision: 0 },
      isPending: false,
      isError: false,
    } as never);
    useWriteBibleMutationMock.mockReturnValue({
      mutateAsync: write,
      isPending: false,
    } as never);

    const saveRef = { current: null as (() => Promise<boolean>) | null };
    const { unmount } = render(
      <StoryBibleEditor projectId="p1" path="canon.md" saveRef={saveRef} />
    );
    expect(await screen.findByDisplayValue("# Canon\nHard facts.\n")).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("canon.md"), "# Canon\nThe fire was arson.\n");
    await waitFor(() => expect(saveRef.current).toBeTruthy());
    await act(async () => {
      await saveRef.current?.();
    });
    expect(write).toHaveBeenCalledWith({
      projectId: "p1",
      path: "canon.md",
      content: "# Canon\nThe fire was arson.\n",
      expectedRevision: 0,
    });
    unmount();
  });
});
