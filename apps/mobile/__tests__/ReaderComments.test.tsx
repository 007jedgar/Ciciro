import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ReaderComments } from "../components/ReaderComments";
import {
  useDeleteShareCommentMutation,
  useSetShareCommentStatusMutation,
  useShareCommentsQuery,
} from "../lib/api";
import type { ShareComment } from "../lib/api/types";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import { colors, makeLayout } from "../lib/theme";

jest.mock("../lib/api", () => {
  class MockApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError: MockApiError,
    useShareCommentsQuery: jest.fn(),
    useSetShareCommentStatusMutation: jest.fn(),
    useDeleteShareCommentMutation: jest.fn(),
  };
});

const listMock = useShareCommentsQuery as jest.Mock;
const statusMock = useSetShareCommentStatusMutation as jest.Mock;
const deleteMock = useDeleteShareCommentMutation as jest.Mock;

const CHAPTERS = [
  { id: "c1", title: "The Harbor" },
  { id: "c2", title: "" },
];

function comment(overrides: Partial<ShareComment>): ShareComment {
  return {
    id: "m1",
    shareLinkId: "l1",
    linkLabel: "Writing group",
    chapterId: "c1",
    chapterTitle: "The Harbor",
    readerName: "Sam",
    body: "Love this image.",
    quote: "cold that morning",
    status: "open",
    createdAt: "2026-09-26T10:00:00.000Z",
    resolvedAt: null,
    anchor: { blockId: "b1", offset: 17, length: 17 },
    ...overrides,
  };
}

const COMMENTS = [
  comment({ id: "m2", chapterId: "c2", chapterTitle: "", quote: "the wreck", body: "Ominous.", readerName: "Jo", linkLabel: "" }),
  comment({ id: "m1" }),
  comment({ id: "m3", quote: "gone words", body: "Where did this go?", anchor: null }),
];

function wrap(ui: ReactNode) {
  return (
    <AppThemeContext.Provider
      value={{ settings: defaultSettings(), colors, layout: makeLayout(colors), dark: false, patch: () => {} }}
    >
      {ui}
    </AppThemeContext.Provider>
  );
}

function setup(opts?: { comments?: ShareComment[]; chapterId?: string }) {
  listMock.mockImplementation((_projectId: string, status: string) => ({
    data: (opts?.comments ?? COMMENTS).filter((c) => c.status === status),
    isPending: false,
    isError: false,
  }));
  const setStatus = jest.fn(async () => ({}));
  const remove = jest.fn(async () => ({ ok: true }));
  statusMock.mockReturnValue({ mutateAsync: setStatus, isPending: false });
  deleteMock.mockReturnValue({ mutateAsync: remove, isPending: false });
  const onJump = jest.fn();
  const onManageLinks = jest.fn();
  const host = {
    alert: jest.fn((_title: string, _message?: string, buttons?: { onPress?: () => void }[]) => {
      buttons?.[buttons.length - 1]?.onPress?.();
    }),
  };
  render(
    wrap(
      <ReaderComments
        projectId="p1"
        chapters={CHAPTERS}
        chapterId={opts?.chapterId}
        onJump={onJump}
        onManageLinks={onManageLinks}
        host={host as never}
      />
    )
  );
  return { setStatus, remove, onJump, onManageLinks, host };
}

describe("ReaderComments", () => {
  it("lists open comments by chapter in manuscript order", () => {
    setup();
    const headings = screen.getAllByText(/^Chapter \d/).map((node) => node.props.children);
    expect(headings).toEqual(["Chapter 1 · The Harbor", "Chapter 2"]);
    expect(screen.getByText("cold that morning")).toBeTruthy();
    expect(screen.getAllByText("Sam · Writing group · Sep 26")).toHaveLength(2);
    expect(screen.getByText("Jo · Sep 26")).toBeTruthy();
  });

  it("jumps to a passage, and says when the passage is gone", () => {
    const { onJump } = setup();
    fireEvent.press(screen.getAllByText("Show in text")[0]);
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
    expect(screen.getByText("Passage no longer in the chapter")).toBeTruthy();
  });

  it("resolves a comment and deletes one after a confirm", async () => {
    const { setStatus, remove, host } = setup();
    fireEvent.press(screen.getAllByText("Resolve")[0]);
    await waitFor(() =>
      expect(setStatus).toHaveBeenCalledWith({ projectId: "p1", commentId: "m1", status: "resolved" })
    );
    fireEvent.press(screen.getAllByText("Delete")[0]);
    expect(host.alert).toHaveBeenCalledWith("Delete this comment?", "It can't be brought back.", expect.any(Array));
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ projectId: "p1", commentId: "m1" }));
  });

  it("starts filtered to the chapter it was opened from", () => {
    setup({ chapterId: "c2" });
    expect(screen.getByText("Ominous.")).toBeTruthy();
    expect(screen.queryByText("Love this image.")).toBeNull();
    fireEvent(screen.getByLabelText("This chapter only"), "valueChange", false);
    expect(screen.getByText("Love this image.")).toBeTruthy();
  });

  it("shows resolved comments with a reopen action", async () => {
    const { setStatus } = setup({ comments: [comment({ status: "resolved" })] });
    expect(screen.getByText(/No open comments/)).toBeTruthy();
    fireEvent.press(screen.getByText("Resolved"));
    fireEvent.press(screen.getByText("Reopen"));
    await waitFor(() =>
      expect(setStatus).toHaveBeenCalledWith({ projectId: "p1", commentId: "m1", status: "open" })
    );
  });

  it("opens the share links screen", () => {
    const { onManageLinks } = setup();
    fireEvent.press(screen.getByLabelText("Share links"));
    expect(onManageLinks).toHaveBeenCalled();
  });
});
