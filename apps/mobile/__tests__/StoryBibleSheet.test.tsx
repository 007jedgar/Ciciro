import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { StoryBibleSheet } from "../components/StoryBibleSheet";
import {
  useBibleFileQuery,
  useBibleIndexQuery,
  useCreateBibleCharacterMutation,
  useWriteBibleMutation,
} from "../lib/api";

jest.mock("../components/GlassSheet", () => {
  const { View } = require("react-native");
  return {
    GlassSheet: ({
      visible,
      children,
      testID,
    }: {
      visible: boolean;
      children: unknown;
      testID?: string;
    }) => (visible ? <View testID={testID}>{children}</View> : null),
  };
});

jest.mock("../lib/api", () => ({
  useBibleIndexQuery: jest.fn(),
  useBibleFileQuery: jest.fn(),
  useWriteBibleMutation: jest.fn(),
  useCreateBibleCharacterMutation: jest.fn(),
}));

const useBibleIndexQueryMock = useBibleIndexQuery as jest.MockedFunction<typeof useBibleIndexQuery>;
const useBibleFileQueryMock = useBibleFileQuery as jest.MockedFunction<typeof useBibleFileQuery>;
const useWriteBibleMutationMock = useWriteBibleMutation as jest.MockedFunction<
  typeof useWriteBibleMutation
>;
const useCreateBibleCharacterMutationMock =
  useCreateBibleCharacterMutation as jest.MockedFunction<typeof useCreateBibleCharacterMutation>;

function mockQueries(options?: {
  entries?: { path: string; summary: string }[];
  file?: { path: string; content: string; revision: number };
  write?: jest.Mock;
  create?: jest.Mock;
}) {
  useBibleIndexQueryMock.mockReturnValue({
    data: options?.entries ?? [
      { path: "canon.md", summary: "Hard facts" },
      { path: "world.md", summary: "Settings and lore" },
    ],
    isPending: false,
    isError: false,
  } as never);
  useBibleFileQueryMock.mockImplementation((_projectId: string, path: string) => {
    const file = options?.file;
    if (file && path === file.path) {
      return { data: file, isPending: false, isError: false } as never;
    }
    return { data: undefined, isPending: Boolean(path), isError: false } as never;
  });
  useWriteBibleMutationMock.mockReturnValue({
    mutateAsync: options?.write ?? jest.fn(async () => ({ ok: true, path: "canon.md", revision: 1 })),
    isPending: false,
  } as never);
  useCreateBibleCharacterMutationMock.mockReturnValue({
    mutateAsync:
      options?.create ??
      jest.fn(async () => ({
        path: "characters/ada.md",
        content: "# Ada\n",
        revision: 0,
      })),
    isPending: false,
  } as never);
}

describe("StoryBibleSheet", () => {
  it("lists bible files so they can be opened", () => {
    mockQueries();
    const { unmount } = render(
      <StoryBibleSheet projectId="p1" visible onClose={jest.fn()} />
    );
    expect(screen.getByText("canon.md")).toBeTruthy();
    expect(screen.getByText("Hard facts")).toBeTruthy();
    expect(screen.getByText("world.md")).toBeTruthy();
    unmount();
  });

  it("opens a file and saves edits", async () => {
    const write = jest.fn(async () => ({ ok: true as const, path: "canon.md", revision: 1 }));
    mockQueries({
      file: { path: "canon.md", content: "# Canon\nHard facts.\n", revision: 0 },
      write,
    });
    const { unmount } = render(
      <StoryBibleSheet projectId="p1" visible onClose={jest.fn()} />
    );
    fireEvent.press(screen.getByLabelText("Open canon.md"));
    expect(await screen.findByDisplayValue("# Canon\nHard facts.\n")).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText("canon.md"), "# Canon\nThe fire was arson.\n");
    fireEvent.press(screen.getByLabelText("Save"));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith({
        projectId: "p1",
        path: "canon.md",
        content: "# Canon\nThe fire was arson.\n",
        expectedRevision: 0,
      })
    );
    unmount();
  });

  it("creates a character file and opens it", async () => {
    const create = jest.fn(async () => ({
      path: "characters/ada.md",
      content: "# Ada\n",
      revision: 0,
    }));
    mockQueries({
      file: { path: "characters/ada.md", content: "# Ada\n", revision: 0 },
      create,
    });
    const { unmount } = render(
      <StoryBibleSheet projectId="p1" visible onClose={jest.fn()} />
    );
    fireEvent.changeText(screen.getByLabelText("New character name"), "Ada");
    fireEvent.press(screen.getByLabelText("Add"));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ projectId: "p1", newCharacter: "Ada" })
    );
    expect(await screen.findByDisplayValue("# Ada\n")).toBeTruthy();
    unmount();
  });
});
