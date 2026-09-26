import { act, renderHook } from "@testing-library/react-native";
import { resetSpeechModule, useDictation } from "../lib/speech";

type Listener = (event: never) => void;

function fakeModule(opts: { available?: boolean; granted?: boolean } = {}) {
  const listeners = new Map<string, Listener>();
  const mod = {
    isRecognitionAvailable: jest.fn(() => opts.available ?? true),
    requestPermissionsAsync: jest.fn(async () => ({
      granted: opts.granted ?? true,
    })),
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
    addListener: jest.fn((event: string, listener: Listener) => {
      listeners.set(event, listener);
      return { remove: jest.fn() };
    }),
  };
  const emit = (event: string, payload?: unknown) =>
    act(() => listeners.get(event)?.(payload as never));
  return { mod, emit };
}

afterEach(() => {
  resetSpeechModule();
  jest.resetModules();
});

describe("useDictation", () => {
  it("is unavailable when the native module is missing (Expo Go)", () => {
    jest.doMock("expo-speech-recognition", () => {
      throw new Error("Cannot find native module 'ExpoSpeechRecognition'");
    });
    const { result } = renderHook(() =>
      useDictation({ lang: "en-US", onPhrase: jest.fn() }),
    );
    expect(result.current.available).toBe(false);
  });

  it("is unavailable when the device has no recognizer", () => {
    const { mod } = fakeModule({ available: false });
    jest.doMock("expo-speech-recognition", () => ({
      ExpoSpeechRecognitionModule: mod,
    }));
    const { result } = renderHook(() =>
      useDictation({ lang: "en-US", onPhrase: jest.fn() }),
    );
    expect(result.current.available).toBe(false);
  });

  it("listens, shows interim text and delivers only final phrases", async () => {
    const { mod, emit } = fakeModule();
    jest.doMock("expo-speech-recognition", () => ({
      ExpoSpeechRecognitionModule: mod,
    }));
    const onPhrase = jest.fn();
    const { result } = renderHook(() =>
      useDictation({ lang: "en-US", onPhrase }),
    );
    expect(result.current.available).toBe(true);

    await act(async () => result.current.toggle());
    expect(mod.start).toHaveBeenCalledWith(
      expect.objectContaining({ lang: "en-US", continuous: true }),
    );
    expect(result.current.listening).toBe(true);

    emit("result", { isFinal: false, results: [{ transcript: "hel" }] });
    expect(result.current.interim).toBe("hel");
    expect(onPhrase).not.toHaveBeenCalled();

    emit("result", { isFinal: true, results: [{ transcript: "hello there" }] });
    expect(onPhrase).toHaveBeenCalledWith("hello there");
    expect(result.current.interim).toBe("");
  });

  it("restarts after a silence timeout until toggled off", async () => {
    const { mod, emit } = fakeModule();
    jest.doMock("expo-speech-recognition", () => ({
      ExpoSpeechRecognitionModule: mod,
    }));
    const { result } = renderHook(() =>
      useDictation({ lang: "en-US", onPhrase: jest.fn() }),
    );
    await act(async () => result.current.toggle());
    emit("end");
    expect(mod.start).toHaveBeenCalledTimes(2);
    act(() => result.current.toggle());
    expect(mod.stop).toHaveBeenCalled();
    emit("end");
    expect(mod.start).toHaveBeenCalledTimes(2);
    expect(result.current.listening).toBe(false);
  });

  it("reports denied permission without starting", async () => {
    const { mod } = fakeModule({ granted: false });
    jest.doMock("expo-speech-recognition", () => ({
      ExpoSpeechRecognitionModule: mod,
    }));
    const onError = jest.fn();
    const { result } = renderHook(() =>
      useDictation({ lang: "en-US", onPhrase: jest.fn(), onError }),
    );
    await act(async () => result.current.toggle());
    expect(onError).toHaveBeenCalledWith("denied");
    expect(mod.start).not.toHaveBeenCalled();
    expect(result.current.listening).toBe(false);
  });

  it("stops for good on a fatal recognizer error", async () => {
    const { mod, emit } = fakeModule();
    jest.doMock("expo-speech-recognition", () => ({
      ExpoSpeechRecognitionModule: mod,
    }));
    const onError = jest.fn();
    const { result } = renderHook(() =>
      useDictation({ lang: "en-US", onPhrase: jest.fn(), onError }),
    );
    await act(async () => result.current.toggle());
    emit("error", { error: "not-allowed" });
    emit("end");
    expect(onError).toHaveBeenCalledWith("denied");
    expect(mod.start).toHaveBeenCalledTimes(1);
    expect(result.current.listening).toBe(false);
  });
});
