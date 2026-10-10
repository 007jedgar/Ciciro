// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ManuscriptSettings from "@/components/ManuscriptSettings";
import { DEFAULT_SCRIPT_SETTINGS, type ScriptSettings } from "@/lib/screenplay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ManuscriptSettings for a screenplay", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onChange = vi.fn<(next: ScriptSettings) => void>();
  const manuscript = { title: "Night Shift", author: "Mara Quill" };

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    onChange.mockReset();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function render(settings: ScriptSettings = DEFAULT_SCRIPT_SETTINGS, kind: "screenplay" | "novel" = "screenplay") {
    await act(async () =>
      root.render(<ManuscriptSettings kind={kind} script={{ settings, manuscript, onChange }} />)
    );
  }
  const toggle = (label: string) => host.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`)!;

  it("is marked Beta and shows nothing for another kind", async () => {
    await render();
    expect(host.querySelector(".kind-settings")?.textContent).toContain("Beta");
    await act(async () => root.render(<ManuscriptSettings kind="novel" script={{ settings: DEFAULT_SCRIPT_SETTINGS, manuscript, onChange }} />));
    expect(host.querySelector(".kind-settings")).toBeNull();
  });

  it("shows the page options as stored: (MORE) and (CONT'D) on, scene numbers off", async () => {
    await render();
    expect(toggle("(MORE) at the foot of a page").getAttribute("aria-checked")).toBe("true");
    expect(toggle("(CONT'D) on the next page").getAttribute("aria-checked")).toBe("true");
    expect(toggle("Scene numbers").getAttribute("aria-checked")).toBe("false");
  });

  it("writes a switch back with the rest of the settings kept", async () => {
    const settings = { ...DEFAULT_SCRIPT_SETTINGS, contd: false };
    await render(settings);
    await act(async () => toggle("Scene numbers").click());
    expect(onChange).toHaveBeenCalledWith({ ...settings, sceneNumbers: true });
    await act(async () => toggle("(MORE) at the foot of a page").click());
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, more: false });
  });

  it("edits the title page, with the manuscript's own title and author as the placeholders", async () => {
    await render();
    const title = host.querySelector<HTMLInputElement>("#title-page-title")!;
    const author = host.querySelector<HTMLInputElement>("#title-page-author")!;
    expect(title.placeholder).toBe("Night Shift");
    expect(author.placeholder).toBe("Mara Quill");
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      set.call(author, "M. Quill");
      author.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_SCRIPT_SETTINGS,
      titlePage: { ...DEFAULT_SCRIPT_SETTINGS.titlePage, author: "M. Quill" },
    });
  });

  it("turns the title page in the PDF off", async () => {
    await render();
    await act(async () => toggle("Title page in the PDF").click());
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SCRIPT_SETTINGS, showTitlePage: false });
  });

  it("limits each title page field", async () => {
    await render();
    const contact = host.querySelector<HTMLTextAreaElement>("#title-page-contact")!;
    expect(contact.maxLength).toBeGreaterThan(0);
    expect(host.querySelector<HTMLInputElement>("#title-page-title")!.maxLength).toBeGreaterThan(0);
  });
});
