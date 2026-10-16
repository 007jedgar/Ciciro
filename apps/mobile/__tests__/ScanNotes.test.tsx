import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, BackHandler } from "react-native";
import { ScanNotes } from "../components/ScanNotes";
import { ApiError } from "../lib/api/client";
import type { ScanApplyResponse, ScanReadingResponse } from "../lib/api/types";

let mockOnline = true;
let mockIndex: { path: string; summary: string }[] = [
  { path: "canon.md", summary: "Hard facts" },
  { path: "world.md", summary: "Settings and lore" },
  { path: "characters/mara-voss.md", summary: "The courier" },
];
const mockPush = jest.fn();
const mockBackOr = jest.fn();
const mockSetOptions = jest.fn();
const mockTrack = jest.fn();
const mockAnnounce = jest.fn();
const mockTake = jest.fn();
const mockPick = jest.fn();
const mockRead = jest.fn();
const mockDiscard = jest.fn();
const mockApply = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useNavigation: () => ({ setOptions: mockSetOptions }),
}));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("../lib/settings", () => ({
  useAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), dark: false, settings: { reduceMotion: false, autoCorrect: false } };
  },
  useOptionalAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), settings: { reduceMotion: false, autoCorrect: false } };
  },
}));
jest.mock("../lib/use-stack-back", () => ({ useStackBack: () => ({ backOr: mockBackOr }) }));
jest.mock("../lib/use-reduce-motion", () => ({ useReduceMotion: () => false }));
jest.mock("../lib/use-online", () => ({ useIsOnline: () => mockOnline }));
jest.mock("../lib/analytics-client", () => ({ getAnalytics: () => ({ track: mockTrack }) }));
jest.mock("../lib/announce", () => ({ announce: (message: string) => mockAnnounce(message) }));
jest.mock("../lib/api", () => ({
  ApiError: jest.requireActual("../lib/api/client").ApiError,
  useBibleIndexQuery: () => ({ data: mockIndex, isPending: false, isError: false }),
  useScanNotesApplyMutation: () => ({
    mutateAsync: (args: unknown) => mockApply(args),
    isPending: false,
  }),
}));
jest.mock("../lib/notes-scan-capture", () => ({
  takePhoto: (...args: unknown[]) => mockTake(...args),
  pickPhotos: (...args: unknown[]) => mockPick(...args),
  readScanPages: (...args: unknown[]) => mockRead(...args),
  discardPhotos: (...args: unknown[]) => mockDiscard(...args),
}));
jest.mock("../components/AppHeader", () => ({
  AppHeader: () => null,
  useMeasuredAppHeaderHeight: () => [0, () => {}],
}));

function photo(n: number) {
  return { uri: `file:///photo-${n}.jpg`, width: 1200, height: 1600 };
}

function reading(overrides: Partial<ScanReadingResponse> = {}): ScanReadingResponse {
  return {
    status: "ok",
    kind: "world",
    title: "The salt flats",
    text: "The salt flats run for [?] miles.\nNo water for three days.",
    pages: [{ legibility: "clear", failed: false }],
    ...overrides,
  } as ScanReadingResponse;
}

function biblePath(path: string, created = false): ScanApplyResponse {
  return { destination: "bible", path, created } as ScanApplyResponse;
}

async function addPhotoFromLibrary(count = 1) {
  mockPick.mockResolvedValueOnce({ kind: "photos", photos: Array.from({ length: count }, (_, i) => photo(i + 1)) });
  await act(async () => {
    fireEvent.press(screen.getByTestId("scan-choose-library"));
  });
}

async function readIt() {
  await act(async () => {
    fireEvent.press(screen.getByTestId("scan-read"));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockIndex = [
    { path: "canon.md", summary: "Hard facts" },
    { path: "world.md", summary: "Settings and lore" },
    { path: "characters/mara-voss.md", summary: "The courier" },
  ];
});

describe("Scan notes", () => {
  it("starts empty with no way to read", () => {
    render(<ScanNotes projectId="p1" />);
    expect(screen.getByTestId("scan-capture")).toBeTruthy();
    expect(screen.getByTestId("scan-read").props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.queryByTestId("scan-pages")).toBeNull();
  });

  it("walks a photo through reading, review and a story bible file", async () => {
    mockRead.mockResolvedValue(reading());
    mockApply.mockResolvedValue(biblePath("world.md"));
    render(<ScanNotes projectId="p1" />);

    await addPhotoFromLibrary();
    expect(screen.getByTestId("scan-pages")).toBeTruthy();
    await readIt();

    await waitFor(() => expect(screen.getByTestId("scan-review")).toBeTruthy());
    expect(mockRead).toHaveBeenCalledWith("p1", [expect.objectContaining({ uri: "file:///photo-1.jpg" })], expect.anything());
    expect(mockTrack).toHaveBeenCalledWith("notes_scan_read", { pages: 1, outcome: "ok" });
    expect(screen.getByTestId("scan-text").props.value).toContain("salt flats");
    expect(screen.getByTestId("scan-unsure")).toBeTruthy();

    fireEvent.press(screen.getByTestId("scan-next"));
    expect(screen.getByTestId("scan-destination")).toBeTruthy();
    // World notes start on the world file.
    expect(screen.getByTestId("scan-file-world.md").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId("scan-suggested")).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId("scan-add"));
    });
    expect(mockApply).toHaveBeenCalledWith({
      projectId: "p1",
      body: {
        text: expect.stringContaining("salt flats"),
        destination: { type: "bible", mode: "append", path: "world.md" },
      },
    });
    expect(screen.getByTestId("scan-done")).toBeTruthy();
    expect(mockTrack).toHaveBeenCalledWith("notes_scan_added", { destination: "bible_file", pages: 1, edited: false });

    fireEvent.press(screen.getByTestId("scan-open"));
    expect(mockPush).toHaveBeenCalledWith("/project/p1/bible/world.md");
  });

  it("marks a scan edited when the writer fixes the text", async () => {
    mockRead.mockResolvedValue(reading());
    mockApply.mockResolvedValue(biblePath("world.md"));
    render(<ScanNotes projectId="p1" />);
    await addPhotoFromLibrary();
    await readIt();
    await waitFor(() => screen.getByTestId("scan-review"));

    fireEvent.changeText(screen.getByTestId("scan-text"), "The salt flats run for 40 miles.");
    expect(screen.queryByTestId("scan-unsure")).toBeNull();
    fireEvent.press(screen.getByTestId("scan-next"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("scan-add"));
    });
    expect(mockTrack).toHaveBeenCalledWith("notes_scan_added", expect.objectContaining({ edited: true }));
  });

  it("sends a list of scenes to the canvas and says how many cards", async () => {
    mockRead.mockResolvedValue(reading({ kind: "outline", title: "Act one", text: "- Heist planned\n- Crew gathers" }));
    mockApply.mockResolvedValue({ destination: "canvas", cards: 2 } as ScanApplyResponse);
    render(<ScanNotes projectId="p1" />);
    await addPhotoFromLibrary();
    await readIt();
    await waitFor(() => screen.getByTestId("scan-review"));
    fireEvent.press(screen.getByTestId("scan-next"));

    expect(screen.queryByTestId("scan-file-world.md")).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId("scan-add"));
    });
    expect(mockApply).toHaveBeenCalledWith({
      projectId: "p1",
      body: { text: "- Heist planned\n- Crew gathers", destination: { type: "canvas" } },
    });
    expect(mockTrack).toHaveBeenCalledWith("notes_scan_added", expect.objectContaining({ destination: "canvas" }));
    expect(screen.getByTestId("scan-done-message").props.children).toMatch(/2/);
  });

  it("starts on the canvas when it was opened from the empty canvas", async () => {
    mockRead.mockResolvedValue(reading({ kind: "world", text: "Some notes" }));
    render(<ScanNotes projectId="p1" to="canvas" />);
    await addPhotoFromLibrary();
    await readIt();
    await waitFor(() => screen.getByTestId("scan-review"));
    fireEvent.press(screen.getByTestId("scan-next"));
    expect(screen.queryByTestId("scan-file-world.md")).toBeNull();
    expect(screen.queryByTestId("scan-suggested")).toBeNull();
  });

  it("creates a new character entry once it has a name", async () => {
    mockRead.mockResolvedValue(reading({ kind: "character", title: "Tobias", text: "Tobias keeps bees." }));
    mockApply.mockResolvedValue(biblePath("characters/tobias.md", true));
    render(<ScanNotes projectId="p1" />);
    await addPhotoFromLibrary();
    await readIt();
    await waitFor(() => screen.getByTestId("scan-review"));
    fireEvent.press(screen.getByTestId("scan-next"));

    expect(screen.getByTestId("scan-new-name").props.value).toBe("Tobias");
    fireEvent.changeText(screen.getByTestId("scan-new-name"), "");
    expect(screen.getByTestId("scan-add").props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.changeText(screen.getByTestId("scan-new-name"), "Tobias Reed");
    await act(async () => {
      fireEvent.press(screen.getByTestId("scan-add"));
    });
    expect(mockApply).toHaveBeenCalledWith({
      projectId: "p1",
      body: {
        text: "Tobias keeps bees.",
        destination: { type: "bible", mode: "new", kind: "character", name: "Tobias Reed" },
      },
    });
    expect(mockTrack).toHaveBeenCalledWith("notes_scan_added", expect.objectContaining({ destination: "bible_new" }));
  });

  it("keeps the text and says so when adding fails", async () => {
    mockRead.mockResolvedValue(reading());
    mockApply.mockRejectedValue(new TypeError("Network request failed"));
    render(<ScanNotes projectId="p1" />);
    await addPhotoFromLibrary();
    await readIt();
    await waitFor(() => screen.getByTestId("scan-review"));
    fireEvent.press(screen.getByTestId("scan-next"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("scan-add"));
    });
    expect(screen.getByTestId("scan-destination")).toBeTruthy();
    expect(screen.getByText(/You're offline/)).toBeTruthy();
    mockApply.mockResolvedValueOnce(biblePath("world.md"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("scan-add"));
    });
    expect(screen.getByTestId("scan-done")).toBeTruthy();
  });

  describe("capturing", () => {
    it("explains a denied camera and still offers the library", async () => {
      mockTake.mockResolvedValue({ kind: "denied", canAskAgain: false });
      render(<ScanNotes projectId="p1" />);
      await act(async () => {
        fireEvent.press(screen.getByTestId("scan-take-photo"));
      });
      expect(screen.getByTestId("scan-camera-denied")).toBeTruthy();
      expect(screen.getByText("Open Settings")).toBeTruthy();
      expect(screen.getByTestId("scan-choose-library").props.accessibilityState).toMatchObject({ disabled: false });
    });

    it("asks again, without a Settings link, while the system can still ask", async () => {
      mockTake.mockResolvedValue({ kind: "denied", canAskAgain: true });
      render(<ScanNotes projectId="p1" />);
      await act(async () => {
        fireEvent.press(screen.getByTestId("scan-take-photo"));
      });
      expect(screen.getByTestId("scan-camera-denied")).toBeTruthy();
      expect(screen.queryByText("Open Settings")).toBeNull();
    });

    it("points to the library on a device with no camera", async () => {
      mockTake.mockResolvedValue({ kind: "unavailable" });
      render(<ScanNotes projectId="p1" />);
      await act(async () => {
        fireEvent.press(screen.getByTestId("scan-take-photo"));
      });
      expect(screen.getByTestId("scan-no-camera")).toBeTruthy();
    });

    it("ignores a cancelled picker", async () => {
      mockPick.mockResolvedValue({ kind: "cancelled" });
      render(<ScanNotes projectId="p1" />);
      await act(async () => {
        fireEvent.press(screen.getByTestId("scan-choose-library"));
      });
      expect(screen.queryByTestId("scan-pages")).toBeNull();
      expect(screen.queryByTestId("scan-no-camera")).toBeNull();
    });

    it("lets a page be removed again and stops at six", async () => {
      render(<ScanNotes projectId="p1" />);
      await addPhotoFromLibrary(6);
      expect(screen.getByTestId("scan-take-photo").props.accessibilityState).toMatchObject({ disabled: true });
      fireEvent.press(screen.getByTestId("scan-remove-2"));
      expect(mockDiscard).toHaveBeenCalledWith(["file:///photo-2.jpg"]);
      expect(screen.queryByTestId("scan-remove-6")).toBeNull();
      expect(screen.getByTestId("scan-take-photo").props.accessibilityState).toMatchObject({ disabled: false });
    });

    it("tells the writer when extra photos were left out", async () => {
      render(<ScanNotes projectId="p1" />);
      await addPhotoFromLibrary(5);
      mockPick.mockResolvedValueOnce({ kind: "photos", photos: [photo(7), photo(8)] });
      await act(async () => {
        fireEvent.press(screen.getByTestId("scan-choose-library"));
      });
      expect(screen.getByTestId("scan-too-many")).toBeTruthy();
    });
  });

  describe("when reading does not work", () => {
    it("keeps the photos and says so for a blurry scan, without using an allowance", async () => {
      mockRead.mockResolvedValue(
        reading({ status: "unreadable", text: "", pages: [{ legibility: "unreadable", failed: false }] })
      );
      render(<ScanNotes projectId="p1" />);
      await addPhotoFromLibrary();
      await readIt();
      await waitFor(() => screen.getByTestId("scan-empty"));
      expect(mockTrack).toHaveBeenCalledWith("notes_scan_read", { pages: 1, outcome: "unreadable" });
      fireEvent.press(screen.getByTestId("scan-empty-back"));
      expect(screen.getByTestId("scan-pages")).toBeTruthy();
    });

    it("flags the pages that could not be read while keeping the rest", async () => {
      mockRead.mockResolvedValue(
        reading({
          status: "partial",
          pages: [
            { legibility: "clear", failed: false },
            { legibility: "unreadable", failed: false },
            { legibility: "clear", failed: true },
          ],
        })
      );
      render(<ScanNotes projectId="p1" />);
      await addPhotoFromLibrary(3);
      await readIt();
      await waitFor(() => screen.getByTestId("scan-review"));
      expect(screen.getByTestId("scan-failed-pages")).toBeTruthy();
      expect(screen.getByTestId("scan-blank-pages")).toBeTruthy();
      expect(mockTrack).toHaveBeenCalledWith("notes_scan_read", { pages: 3, outcome: "partial" });
    });

    it("blocks Read while offline and keeps the photos", async () => {
      mockOnline = false;
      render(<ScanNotes projectId="p1" />);
      await addPhotoFromLibrary();
      expect(screen.getByTestId("scan-offline")).toBeTruthy();
      expect(screen.getByTestId("scan-read").props.accessibilityState).toMatchObject({ disabled: true });
      await readIt();
      expect(mockRead).not.toHaveBeenCalled();
    });

    it("returns to the photos when the connection drops mid-read", async () => {
      mockRead.mockRejectedValue(new TypeError("Network request failed"));
      render(<ScanNotes projectId="p1" />);
      await addPhotoFromLibrary();
      await readIt();
      await waitFor(() => screen.getByTestId("scan-failure"));
      expect(screen.getByText(/You're offline/)).toBeTruthy();
      expect(screen.getByTestId("scan-pages")).toBeTruthy();
      expect(mockTrack).toHaveBeenCalledWith("notes_scan_read", { pages: 1, outcome: "offline" });
    });

    it("says the allowance is used up and keeps the photos", async () => {
      mockRead.mockRejectedValue(new ApiError("Limit", 402, { code: "ai_limit_reached", entitlement: { plan: "free" } }));
      render(<ScanNotes projectId="p1" />);
      await addPhotoFromLibrary();
      await readIt();
      await waitFor(() => screen.getByTestId("scan-failure"));
      expect(screen.getByText(/used this month's free AI allowance/)).toBeTruthy();
      expect(mockTrack).toHaveBeenCalledWith("notes_scan_read", { pages: 1, outcome: "limit" });
      // The photos wait for another try.
      expect(screen.getByTestId("scan-pages")).toBeTruthy();
    });

    it("clears an old failure once the photos change", async () => {
      mockRead.mockRejectedValue(new TypeError("Network request failed"));
      render(<ScanNotes projectId="p1" />);
      await addPhotoFromLibrary();
      await readIt();
      await waitFor(() => screen.getByTestId("scan-failure"));
      fireEvent.press(screen.getByTestId("scan-remove-1"));
      expect(screen.queryByTestId("scan-failure")).toBeNull();
      expect(screen.getByText("Read notes")).toBeTruthy();
    });

    it("can be cancelled while reading", async () => {
      let signal: AbortSignal | undefined;
      mockRead.mockImplementation(
        (_id: string, _pages: unknown, sig: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal = sig;
            sig.addEventListener("abort", () => reject(new Error("aborted")));
          })
      );
      render(<ScanNotes projectId="p1" />);
      await addPhotoFromLibrary();
      await readIt();
      expect(screen.getByTestId("scan-reading")).toBeTruthy();
      await act(async () => {
        fireEvent.press(screen.getByTestId("scan-cancel-read"));
      });
      expect(signal?.aborted).toBe(true);
      expect(screen.getByTestId("scan-pages")).toBeTruthy();
      expect(screen.queryByTestId("scan-failure")).toBeNull();
    });
  });

  describe("leaving", () => {
    let pressBack: (() => boolean) | undefined;

    beforeEach(() => {
      pressBack = undefined;
      jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, handler) => {
        pressBack = handler as () => boolean;
        return { remove: () => {} };
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("leaves straight away when nothing is at stake", () => {
      render(<ScanNotes projectId="p1" />);
      expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });
      const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
      act(() => {
        expect(pressBack?.()).toBe(true);
      });
      expect(alert).not.toHaveBeenCalled();
      expect(mockBackOr).toHaveBeenCalledWith("/project/p1/chapters");
    });

    it("turns the swipe-back gesture off and asks before closing a reading", async () => {
      const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
      mockRead.mockResolvedValue(reading());
      render(<ScanNotes projectId="p1" />);
      await addPhotoFromLibrary();
      await readIt();
      await waitFor(() => screen.getByTestId("scan-review"));
      expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: false });

      act(() => {
        pressBack?.();
      });
      expect(mockBackOr).not.toHaveBeenCalled();
      expect(alert).toHaveBeenCalledWith(
        "Leave without adding?",
        expect.any(String),
        expect.arrayContaining([expect.objectContaining({ text: "Stay" }), expect.objectContaining({ text: "Leave" })])
      );
      const buttons = alert.mock.calls[0]![2]!;
      act(() => {
        buttons.find((button) => button.text === "Leave")!.onPress!();
      });
      expect(mockBackOr).toHaveBeenCalledWith("/project/p1/chapters");
    });

    it("lets go of the gesture guard once the notes are added", async () => {
      mockRead.mockResolvedValue(reading());
      mockApply.mockResolvedValue(biblePath("world.md"));
      render(<ScanNotes projectId="p1" />);
      await addPhotoFromLibrary();
      await readIt();
      await waitFor(() => screen.getByTestId("scan-review"));
      fireEvent.press(screen.getByTestId("scan-next"));
      await act(async () => {
        fireEvent.press(screen.getByTestId("scan-add"));
      });
      expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });
    });

    it("clears its photos from the cache when it closes", async () => {
      const view = render(<ScanNotes projectId="p1" />);
      await addPhotoFromLibrary(2);
      view.unmount();
      expect(mockDiscard).toHaveBeenCalledWith(["file:///photo-1.jpg", "file:///photo-2.jpg"]);
    });
  });
});
