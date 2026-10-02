// @vitest-environment jsdom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorHandle } from "@/components/Editor";
import ReadAloud from "@/components/ReadAloud";
import { getTtsPrefs, setTtsPrefs } from "@/lib/tts-prefs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Voice = { name: string; lang: string; voiceURI: string };

class FakeUtterance {
  rate = 1;
  voice: unknown = null;
  lang = "";
  onend: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(public text: string) {}
}

let root: Root;
let host: HTMLDivElement;
let voices: Voice[];
let spoken: FakeUtterance[];
let synth: EventTarget;

function editorRef() {
  const ref = createRef<EditorHandle | null>() as { current: EditorHandle | null };
  ref.current = {
    beginReadAloud: () => ({ sentences: [{ text: "Bonjour." }], selection: false }),
    readAloudSentence: () => ({ text: "Bonjour." }),
    highlightReadAloud: () => {},
  } as unknown as EditorHandle;
  return ref;
}

async function mount() {
  await act(async () => root.render(<ReadAloud editorRef={editorRef()} resetKey="c1" />));
  await act(async () => {
    Array.from(document.querySelectorAll("button"))
      .find((b) => b.textContent === "Listen")!
      .click();
  });
}

async function fireVoicesChanged(next: Voice[]) {
  voices = next;
  await act(async () => {
    synth.dispatchEvent(new Event("voiceschanged"));
  });
}

const voiceSelect = () =>
  Array.from(document.querySelectorAll<HTMLSelectElement>(".read-aloud select")).find(
    (s) => s.options[0]?.textContent === "Default"
  ) ?? null;

beforeEach(() => {
  voices = [];
  spoken = [];
  synth = Object.assign(new EventTarget(), {
    getVoices: () => voices,
    speak: (u: FakeUtterance) => spoken.push(u),
    cancel: () => {},
    pause: () => {},
    resume: () => {},
  });
  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.spyOn(navigator, "language", "get").mockReturnValue("fr-FR");
  setTtsPrefs({ voiceURI: null, rate: 1 });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ReadAloud voices", () => {
  it("lists only voices in the browser's language", async () => {
    await mount();
    await fireVoicesChanged([
      { name: "Samantha", lang: "en-US", voiceURI: "sam" },
      { name: "Amelie", lang: "fr-CA", voiceURI: "amelie" },
      { name: "Thomas", lang: "fr-FR", voiceURI: "thomas" },
    ]);
    const options = Array.from(voiceSelect()!.options).map((o) => o.textContent);
    expect(options).toEqual(["Default", "Amelie (fr-CA)", "Thomas (fr-FR)"]);
  });

  it("keeps a saved voice through a load that is missing it", async () => {
    setTtsPrefs({ voiceURI: "thomas" });
    await mount();
    await fireVoicesChanged([{ name: "Amelie", lang: "fr-CA", voiceURI: "amelie" }]);
    expect(voiceSelect()!.value).toBe("");
    expect(getTtsPrefs().voiceURI).toBe("thomas");

    await fireVoicesChanged([
      { name: "Amelie", lang: "fr-CA", voiceURI: "amelie" },
      { name: "Thomas", lang: "fr-FR", voiceURI: "thomas" },
    ]);
    expect(voiceSelect()!.value).toBe("thomas");
  });

  it("explains the default voice reads when none match, and still plays in the browser's language", async () => {
    await mount();
    await fireVoicesChanged([{ name: "Samantha", lang: "en-US", voiceURI: "sam" }]);
    expect(voiceSelect()).toBeNull();
    expect(document.querySelector(".read-aloud-empty")!.textContent).toBe(
      "No fr-FR voices are installed on this device, so its default voice will read"
    );

    const play = Array.from(document.querySelectorAll<HTMLButtonElement>(".read-aloud button")).find(
      (b) => b.textContent === "Play"
    )!;
    expect(play.disabled).toBe(false);
    await act(async () => play.click());
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe("Bonjour.");
    expect(spoken[0].lang).toBe("fr-FR");
    expect(spoken[0].voice).toBeNull();
  });
});
