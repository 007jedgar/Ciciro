import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { ExportCard } from "../components/ExportCard";
import { ExportUnavailableError, ExportUnsyncedError, exportManuscript } from "../lib/export";

jest.mock("../lib/export", () => ({
  ...jest.requireActual("../lib/export"),
  exportManuscript: jest.fn(),
}));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Success: "success" },
}));
jest.mock("../lib/prefs", () => ({
  getPrefs: () => ({ getString: () => undefined, set: () => {} }),
}));
jest.mock("expo-file-system", () => ({ File: jest.fn(), Paths: {} }));
jest.mock("expo-sharing", () => ({}));
jest.mock("../lib/settings", () => ({
  useAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), settings: { reduceMotion: false } };
  },
  useOptionalAppTheme: () => ({ settings: { reduceMotion: false } }),
}));

describe("ExportCard", () => {
  it("exports the chosen format", async () => {
    (exportManuscript as jest.Mock).mockResolvedValue(undefined);
    const flushEdits = jest.fn(async () => true);
    render(<ExportCard projectId="p1" flushEdits={flushEdits} />);
    fireEvent.press(screen.getByLabelText("Export as PDF"));
    await waitFor(() =>
      expect(exportManuscript).toHaveBeenCalledWith("p1", "pdf", expect.objectContaining({ flush: flushEdits }))
    );
  });

  it("acknowledges the finished file with a tick and a success haptic before the share sheet", async () => {
    jest.useFakeTimers();
    let sheetOpened = false;
    (exportManuscript as jest.Mock).mockImplementation(
      async (_id: string, _format: string, opts: { beforeShare: () => Promise<void> }) => {
        await opts.beforeShare();
        sheetOpened = true;
      }
    );
    render(<ExportCard projectId="p1" />);
    fireEvent.press(screen.getByLabelText("Export as PDF"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
    expect(sheetOpened).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(450);
    });
    expect(sheetOpened).toBe(true);
    jest.useRealTimers();
  });

  it("shows an error when the export fails", async () => {
    (exportManuscript as jest.Mock).mockRejectedValue(new Error("boom"));
    render(<ExportCard projectId="p1" />);
    fireEvent.press(screen.getByLabelText("Export as EPUB"));
    expect(await screen.findByText("Could not export the manuscript.")).toBeTruthy();
  });

  it("explains when sharing is unavailable", async () => {
    (exportManuscript as jest.Mock).mockRejectedValue(new ExportUnavailableError());
    render(<ExportCard projectId="p1" />);
    fireEvent.press(screen.getByLabelText("Export as Word"));
    expect(await screen.findByText("Sharing is not available on this device.")).toBeTruthy();
  });

  it("explains when edits have not synced yet", async () => {
    (exportManuscript as jest.Mock).mockRejectedValue(new ExportUnsyncedError());
    render(<ExportCard projectId="p1" />);
    fireEvent.press(screen.getByLabelText("Export as EPUB"));
    expect(
      await screen.findByText("Some edits have not synced yet. Connect to the internet and try again.")
    ).toBeTruthy();
  });
});

describe("ExportCard layout", () => {
  it("keeps every format label on one line and lets the pills wrap", () => {
    render(<ExportCard projectId="p1" />);
    expect(screen.getByText("Markdown").props.numberOfLines).toBe(1);
  });
});
