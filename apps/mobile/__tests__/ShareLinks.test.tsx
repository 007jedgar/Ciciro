import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ShareLinks } from "../components/ShareLinks";
import {
  useCreateShareLinkMutation,
  useDeleteShareLinkMutation,
  useRevokeShareLinkMutation,
  useShareLinksQuery,
} from "../lib/api";
import type { ShareLinkSummary } from "../lib/api/types";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import { colors, makeLayout } from "../lib/theme";

jest.mock("../lib/api/client", () => ({ API_URL: "https://ciciro.example" }));

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
    useShareLinksQuery: jest.fn(),
    useCreateShareLinkMutation: jest.fn(),
    useRevokeShareLinkMutation: jest.fn(),
    useDeleteShareLinkMutation: jest.fn(),
  };
});

const listMock = useShareLinksQuery as jest.Mock;
const createMock = useCreateShareLinkMutation as jest.Mock;
const revokeMock = useRevokeShareLinkMutation as jest.Mock;
const deleteMock = useDeleteShareLinkMutation as jest.Mock;

const CHAPTERS = [
  { id: "c1", title: "The Harbor" },
  { id: "c2", title: "Low Tide" },
];

function link(overrides: Partial<ShareLinkSummary>): ShareLinkSummary {
  return {
    id: "l1",
    projectId: "p1",
    label: "Writing group",
    path: "/read/tok1",
    token: "tok1",
    chapterIds: [],
    expiresAt: "2026-10-26T12:00:00.000Z",
    revokedAt: null,
    status: "active",
    commentCount: 2,
    openCommentCount: 1,
    createdAt: "2026-09-26T12:00:00.000Z",
    ...overrides,
  };
}

function wrap(ui: ReactNode) {
  return (
    <AppThemeContext.Provider
      value={{ settings: defaultSettings(), colors, layout: makeLayout(colors), dark: false, patch: () => {} }}
    >
      {ui}
    </AppThemeContext.Provider>
  );
}

function setup(links: ShareLinkSummary[] = [link({})]) {
  listMock.mockReturnValue({ data: links, isPending: false, isError: false });
  const create = jest.fn(async () => link({ id: "l9", path: "/read/new", label: "" }));
  const revoke = jest.fn(async () => link({ status: "revoked" }));
  const remove = jest.fn(async () => ({ ok: true }));
  createMock.mockReturnValue({ mutateAsync: create, isPending: false });
  revokeMock.mockReturnValue({ mutateAsync: revoke, isPending: false });
  deleteMock.mockReturnValue({ mutateAsync: remove, isPending: false });
  const host = {
    alert: jest.fn((_title: string, _message?: string, buttons?: { onPress?: () => void }[]) => {
      buttons?.[buttons.length - 1]?.onPress?.();
    }),
    share: jest.fn(async () => ({})),
  };
  render(wrap(<ShareLinks projectId="p1" projectTitle="The Salt Sea" chapters={CHAPTERS} host={host} />));
  return { create, revoke, remove, host };
}

describe("ShareLinks", () => {
  it("makes a whole-manuscript link and opens the share sheet with it", async () => {
    const { create, host } = setup([]);
    fireEvent.changeText(screen.getByLabelText("Who is it for?"), "Sam");
    fireEvent.press(screen.getByText("Never"));
    fireEvent.press(screen.getByLabelText("Make link and share"));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        projectId: "p1",
        body: { label: "Sam", chapterIds: [], expiresInDays: null },
      })
    );
    await waitFor(() => expect(host.share).toHaveBeenCalled());
    expect(host.share).toHaveBeenCalledWith({
      message: expect.stringContaining("https://ciciro.example/read/new"),
      url: "https://ciciro.example/read/new",
    });
  });

  it("shares only the chapters picked", async () => {
    const { create } = setup([]);
    fireEvent.press(screen.getByText("Chosen chapters"));
    fireEvent.press(screen.getByLabelText("Make link and share"));
    expect(screen.getByText("Pick at least one chapter to share.")).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText("Chapter 2 · Low Tide"));
    fireEvent.press(screen.getByLabelText("Make link and share"));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        projectId: "p1",
        body: { label: "", chapterIds: ["c2"], expiresInDays: 30 },
      })
    );
  });

  it("describes each link and its state", () => {
    setup([
      link({}),
      link({ id: "l2", label: "", chapterIds: ["c1"], status: "revoked", revokedAt: "2026-09-27T12:00:00.000Z", commentCount: 1 }),
      link({ id: "l3", label: "Old", expiresAt: null, status: "expired", commentCount: 0 }),
    ]);
    expect(screen.getByText("Whole manuscript · Expires Oct 26 · 2 comments")).toBeTruthy();
    expect(screen.getByText("Untitled link")).toBeTruthy();
    expect(screen.getByText("1 chapter · Turned off Sep 27 · 1 comment")).toBeTruthy();
    expect(screen.getByText("https://ciciro.example/read/tok1")).toBeTruthy();
    // Only the active link can be shared or turned off.
    expect(screen.getAllByText("Share link")).toHaveLength(1);
    expect(screen.getAllByText("Turn off")).toHaveLength(1);
  });

  it("turns a link off and deletes one after confirming", async () => {
    const { revoke, remove, host } = setup();
    fireEvent.press(screen.getByText("Turn off"));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith({ projectId: "p1", linkId: "l1" }));
    fireEvent.press(screen.getByText("Delete"));
    expect(host.alert).toHaveBeenLastCalledWith(
      "Delete this link?",
      "Its 2 comments are deleted too. This can't be undone.",
      expect.any(Array)
    );
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ projectId: "p1", linkId: "l1" }));
  });
});
