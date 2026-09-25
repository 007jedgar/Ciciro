import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ChapterHistory } from "../components/ChapterHistory";
import {
  ApiError,
  useChapterSnapshotQuery,
  useChapterSnapshotsQuery,
  useDeleteSnapshotMutation,
  useRestoreSnapshotMutation,
  useSaveSnapshotMutation,
} from "../lib/api";
import type { ChapterSnapshotSummary } from "../lib/api/types";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import { colors, makeLayout } from "../lib/theme";

jest.mock("../lib/use-reduce-motion", () => ({ useReduceMotion: () => true }));

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});

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
    useChapterSnapshotsQuery: jest.fn(),
    useChapterSnapshotQuery: jest.fn(),
    useSaveSnapshotMutation: jest.fn(),
    useRestoreSnapshotMutation: jest.fn(),
    useDeleteSnapshotMutation: jest.fn(),
  };
});

const listMock = useChapterSnapshotsQuery as jest.Mock;
const detailMock = useChapterSnapshotQuery as jest.Mock;
const saveMock = useSaveSnapshotMutation as jest.Mock;
const restoreMock = useRestoreSnapshotMutation as jest.Mock;
const deleteMock = useDeleteSnapshotMutation as jest.Mock;

const today = new Date();
today.setHours(9, 5, 0, 0);

const SNAPSHOTS: ChapterSnapshotSummary[] = [
  {
    id: "s2",
    chapterId: "c1",
    kind: "before_ai",
    label: "",
    wordCount: 6,
    revision: 4,
    createdAt: today.toISOString(),
  },
  {
    id: "s1",
    chapterId: "c1",
    kind: "manual",
    label: "First pass",
    wordCount: 1,
    revision: 1,
    createdAt: today.toISOString(),
  },
];

const CONTENT: Record<string, string> = {
  s1: "<p>Cold.</p>",
  s2: "<p>The hall was cold.</p><p>She waited.</p>",
};

function wrap(ui: ReactNode) {
  return (
    <AppThemeContext.Provider
      value={{ settings: defaultSettings(), colors, layout: makeLayout(colors), dark: false, patch: () => {} }}
    >
      {ui}
    </AppThemeContext.Provider>
  );
}

function setup(opts?: { restore?: jest.Mock; save?: jest.Mock; settle?: jest.Mock }) {
  listMock.mockReturnValue({ data: SNAPSHOTS, isPending: false, isError: false });
  detailMock.mockImplementation((_chapterId: string, snapshotId: string) => ({
    data: snapshotId
      ? { ...SNAPSHOTS.find((s) => s.id === snapshotId)!, content: CONTENT[snapshotId] }
      : undefined,
    isError: false,
  }));
  const save = opts?.save ?? jest.fn(async () => SNAPSHOTS[1]);
  const restore =
    opts?.restore ??
    jest.fn(async ({ snapshotId }: { snapshotId: string }) => ({
      chapter: { id: "c1" },
      restored: SNAPSHOTS.find((s) => s.id === snapshotId),
      backup: { ...SNAPSHOTS[0], id: "backup", kind: "before_restore" },
    }));
  saveMock.mockReturnValue({ mutateAsync: save, isPending: false });
  restoreMock.mockReturnValue({ mutateAsync: restore, isPending: false });
  deleteMock.mockReturnValue({ mutateAsync: jest.fn(async () => ({ ok: true })), isPending: false });
  const settle = opts?.settle ?? jest.fn(async () => true);
  // Press the confirming button of whatever the screen asks.
  const host = {
    alert: jest.fn((_title: string, _message?: string, buttons?: { onPress?: () => void }[]) => {
      buttons?.[buttons.length - 1]?.onPress?.();
    }),
  };
  render(
    wrap(
      <ChapterHistory
        chapterId="c1"
        currentContent="<p>The hall was warm.</p><p>She waited.</p>"
        settle={settle}
        host={host as never}
      />
    )
  );
  return { save, restore, settle, host };
}

describe("ChapterHistory", () => {
  it("lists versions by name, or by how they were taken", () => {
    setup();
    expect(screen.getByText("Before Ciciro's edits")).toBeTruthy();
    expect(screen.getByText("First pass")).toBeTruthy();
    expect(screen.getByText(/Today, 9:05 AM · 6 words/)).toBeTruthy();
  });

  it("compares a version with the current text, and shows its full text", () => {
    setup();
    fireEvent.press(screen.getByLabelText(/Before Ciciro's edits, Today/));
    expect(screen.getByText("Restoring brings back 1 word and removes 1 word.")).toBeTruthy();
    expect(screen.getByTestId("snapshot-diff")).toHaveTextContent(/The hall was warm\s*cold\./);
    fireEvent.press(screen.getByText("Full text"));
    expect(screen.getByTestId("snapshot-text")).toHaveTextContent(/The hall was cold\.\s+She waited\./);
  });

  it("lands queued typing before saving a named snapshot", async () => {
    const { save, settle } = setup();
    fireEvent.changeText(screen.getByLabelText("Name this version (optional)"), "  Draft two ");
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Save snapshot"));
    });
    expect(settle).toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith({ chapterId: "c1", label: "Draft two" });
    expect(settle.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0]);
  });

  it("restores after confirming, syncs around it, and offers undo", async () => {
    const { restore, settle, host } = setup();
    fireEvent.press(screen.getByLabelText(/First pass, Today/));
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Restore"));
    });
    expect(host.alert).toHaveBeenCalledWith(
      "Restore this version?",
      expect.stringContaining("undo"),
      expect.any(Array)
    );
    expect(restore).toHaveBeenCalledWith({ chapterId: "c1", snapshotId: "s1" });
    // Push before the restore, pull the restored ops after it.
    expect(settle).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByText("Version restored.")).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Undo"));
    });
    expect(restore).toHaveBeenLastCalledWith({ chapterId: "c1", snapshotId: "backup" });
    await waitFor(() => expect(screen.getByText("Restore undone.")).toBeTruthy());
  });

  it("refuses to restore or save while this chapter's edits are still queued", async () => {
    const settle = jest.fn(async () => false);
    const { restore, save } = setup({ settle });
    fireEvent.press(screen.getByLabelText(/First pass, Today/));
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Restore"));
    });
    expect(settle).toHaveBeenCalledTimes(1);
    expect(restore).not.toHaveBeenCalled();
    expect(
      screen.getByText("Some of your latest edits have not reached the server yet. Reconnect and try again.")
    ).toBeTruthy();
    expect(screen.queryByText("Version restored.")).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Save snapshot"));
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("explains a failed restore", async () => {
    const restore = jest.fn(async () => {
      throw new ApiError("The chapter kept changing while restoring. Try again.", 409);
    });
    setup({ restore });
    fireEvent.press(screen.getByLabelText(/First pass, Today/));
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Restore"));
    });
    expect(screen.getByText("The chapter kept changing while restoring. Try again.")).toBeTruthy();
    expect(screen.queryByText("Version restored.")).toBeNull();
  });
});
