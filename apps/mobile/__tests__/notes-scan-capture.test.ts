import { SaveFormat } from "expo-image-manipulator";
import {
  discardPhotos,
  pickPhotos,
  prepareScanPhoto,
  readScanPages,
  takePhoto,
} from "../lib/notes-scan-capture";

const mockGetCamera = jest.fn();
const mockRequestCamera = jest.fn();
const mockLaunchCamera = jest.fn();
const mockLaunchLibrary = jest.fn();
const mockResize = jest.fn();
const mockRender = jest.fn();
const mockSave = jest.fn();
const mockDelete = jest.fn();
const mockExists = jest.fn();
const mockRead = jest.fn();

jest.mock("expo-image-picker", () => ({
  getCameraPermissionsAsync: (...args: unknown[]) => mockGetCamera(...args),
  requestCameraPermissionsAsync: (...args: unknown[]) => mockRequestCamera(...args),
  launchCameraAsync: (...args: unknown[]) => mockLaunchCamera(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchLibrary(...args),
}));
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: {
    manipulate: () => ({
      resize: (...args: unknown[]) => mockResize(...args),
      renderAsync: async () => {
        mockRender();
        return { saveAsync: async (...args: unknown[]) => mockSave(...args) };
      },
    }),
  },
}));
jest.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return mockExists(this.uri);
    }
    delete() {
      mockDelete(this.uri);
    }
  },
}));
jest.mock("../lib/api", () => ({
  ciciro: { projects: { scanNotes: { read: (...args: unknown[]) => mockRead(...args) } } },
}));

const asset = (n: number) => ({ uri: `file:///a${n}.heic`, width: 3000, height: 4000 });

beforeEach(() => {
  jest.clearAllMocks();
  mockExists.mockReturnValue(true);
  mockSave.mockImplementation(async () => ({ uri: "file:///resized.jpg" }));
});

describe("takePhoto", () => {
  it("opens the camera when access is already granted", async () => {
    mockGetCamera.mockResolvedValue({ granted: true, canAskAgain: true });
    mockLaunchCamera.mockResolvedValue({ canceled: false, assets: [asset(1)] });
    await expect(takePhoto()).resolves.toEqual({
      kind: "photos",
      photos: [{ uri: "file:///a1.heic", width: 3000, height: 4000 }],
    });
    expect(mockRequestCamera).not.toHaveBeenCalled();
  });

  it("asks once and opens the camera when the writer allows it", async () => {
    mockGetCamera.mockResolvedValue({ granted: false, canAskAgain: true });
    mockRequestCamera.mockResolvedValue({ granted: true, canAskAgain: true });
    mockLaunchCamera.mockResolvedValue({ canceled: false, assets: [asset(1)] });
    expect((await takePhoto()).kind).toBe("photos");
    expect(mockRequestCamera).toHaveBeenCalledTimes(1);
  });

  it("reports a refusal that can be asked again", async () => {
    mockGetCamera.mockResolvedValue({ granted: false, canAskAgain: true });
    mockRequestCamera.mockResolvedValue({ granted: false, canAskAgain: true });
    await expect(takePhoto()).resolves.toEqual({ kind: "denied", canAskAgain: true });
    expect(mockLaunchCamera).not.toHaveBeenCalled();
  });

  it("does not ask again once only Settings can help", async () => {
    mockGetCamera.mockResolvedValue({ granted: false, canAskAgain: false });
    await expect(takePhoto()).resolves.toEqual({ kind: "denied", canAskAgain: false });
    expect(mockRequestCamera).not.toHaveBeenCalled();
  });

  it("calls a camera that will not open unavailable", async () => {
    mockGetCamera.mockResolvedValue({ granted: true, canAskAgain: true });
    mockLaunchCamera.mockRejectedValue(new Error("Camera not available on simulator"));
    await expect(takePhoto()).resolves.toEqual({ kind: "unavailable" });
  });

  it("treats a cancelled capture as nothing", async () => {
    mockGetCamera.mockResolvedValue({ granted: true, canAskAgain: true });
    mockLaunchCamera.mockResolvedValue({ canceled: true, assets: null });
    await expect(takePhoto()).resolves.toEqual({ kind: "cancelled" });
  });
});

describe("pickPhotos", () => {
  it("picks several in the order tapped, up to the room left", async () => {
    mockLaunchLibrary.mockResolvedValue({ canceled: false, assets: [asset(1), asset(2)] });
    const result = await pickPhotos(4);
    expect(result).toMatchObject({ kind: "photos", photos: [{ uri: "file:///a1.heic" }, { uri: "file:///a2.heic" }] });
    expect(mockLaunchLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ allowsMultipleSelection: true, orderedSelection: true, selectionLimit: 4 })
    );
  });

  it("never asks for more than a scan holds or fewer than one", async () => {
    mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: null });
    await pickPhotos(40);
    expect(mockLaunchLibrary).toHaveBeenLastCalledWith(expect.objectContaining({ selectionLimit: 6 }));
    await pickPhotos(0);
    expect(mockLaunchLibrary).toHaveBeenLastCalledWith(expect.objectContaining({ selectionLimit: 1 }));
  });
});

describe("prepareScanPhoto", () => {
  it("shrinks a big photo and saves a JPEG", async () => {
    await expect(prepareScanPhoto({ uri: "file:///big.heic", width: 3000, height: 4000 })).resolves.toBe(
      "file:///resized.jpg"
    );
    expect(mockResize).toHaveBeenCalledWith({ width: 1350 });
    expect(mockSave).toHaveBeenCalledWith({ format: SaveFormat.JPEG, compress: 0.8 });
  });

  it("re-encodes a small photo without resizing it", async () => {
    await prepareScanPhoto({ uri: "file:///small.png", width: 900, height: 1200 });
    expect(mockResize).not.toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalled();
  });
});

describe("readScanPages", () => {
  const pages = [
    { id: "1", ...asset(1) },
    { id: "2", ...asset(2) },
  ];

  // Spy on `append` so the test sees the parts as given (Node's FormData would reject a mocked File).
  let append: jest.SpyInstance;
  beforeEach(() => {
    append = jest.spyOn(FormData.prototype, "append").mockImplementation(() => {});
  });
  afterEach(() => append.mockRestore());

  it("sends every page as a file part and removes the resized copies", async () => {
    mockSave.mockResolvedValueOnce({ uri: "file:///r1.jpg" }).mockResolvedValueOnce({ uri: "file:///r2.jpg" });
    mockRead.mockResolvedValue({ status: "ok" });
    const signal = new AbortController().signal;
    await expect(readScanPages("p1", pages, signal)).resolves.toEqual({ status: "ok" });

    const [projectId, , options] = mockRead.mock.calls[0]!;
    expect(projectId).toBe("p1");
    expect(options).toEqual({ signal });
    expect(append.mock.calls.map(([field]) => field)).toEqual(["page", "page"]);
    // Each part is the resized file itself (a `File`), never a `{ uri }` descriptor.
    expect(append.mock.calls.map(([, , filename]) => filename)).toEqual(["page-1.jpg", "page-2.jpg"]);
    const parts = append.mock.calls.map(([, part]) => part as unknown as { uri: string });
    expect(parts.map((part) => part.uri)).toEqual(["file:///r1.jpg", "file:///r2.jpg"]);
    expect(parts.every((part) => part.constructor.name === "File")).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith("file:///r1.jpg");
    expect(mockDelete).toHaveBeenCalledWith("file:///r2.jpg");
  });

  it("still removes the resized copies when the request fails", async () => {
    mockSave.mockResolvedValueOnce({ uri: "file:///r1.jpg" }).mockResolvedValueOnce({ uri: "file:///r2.jpg" });
    mockRead.mockRejectedValue(new Error("down"));
    await expect(readScanPages("p1", pages)).rejects.toThrow("down");
    expect(mockDelete).toHaveBeenCalledTimes(2);
  });
});

describe("discardPhotos", () => {
  it("removes files that exist and skips ones already gone", () => {
    mockExists.mockImplementation((uri: string) => uri !== "file:///gone.jpg");
    discardPhotos(["file:///a.jpg", "file:///gone.jpg"]);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith("file:///a.jpg");
  });

  it("never throws", () => {
    mockExists.mockImplementation(() => {
      throw new Error("not ours");
    });
    expect(() => discardPhotos(["file:///a.jpg"])).not.toThrow();
  });
});
