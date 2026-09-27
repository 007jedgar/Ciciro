import { describe, expect, it } from "vitest";
import { createHeldWrites } from "@/lib/held-writes";

// A stand-in page: text that writes append to, the chapter it shows, and
// whether that chapter is held for its Undo.
function page() {
  const held = new Set<string>();
  const state = { showing: "c1", ready: true, text: "" };
  const editor = { insert: (words: string) => (state.text += words) };
  const writes = createHeldWrites<typeof editor>({
    isHeld: (id) => held.has(id),
    target: (id) => (id === state.showing && state.ready ? editor : null),
  });
  return { held, state, writes };
}

describe("held editor writes", () => {
  it("writes straight through when nothing holds the chapter", () => {
    const p = page();
    p.writes.write("c1", (e) => e.insert("hello"));
    expect(p.state.text).toBe("hello");
    expect(p.writes.size).toBe(0);
  });

  it("keeps dictation and drafts that arrive during a restore, and lands them in order once it lets go", () => {
    const p = page();
    p.held.add("c1");
    p.writes.write("c1", (e) => e.insert(" dictated"));
    p.writes.write("c1", (e) => e.insert(" drafted"));
    expect(p.state.text).toBe("");
    expect(p.writes.size).toBe(2);
    p.held.delete("c1");
    // The restore remounts the page; nothing lands until the new one is ready.
    p.state.ready = false;
    p.writes.flush();
    expect(p.state.text).toBe("");
    p.state.ready = true;
    p.writes.flush();
    expect(p.state.text).toBe(" dictated drafted");
    expect(p.writes.size).toBe(0);
  });

  it("does not jump the queue: a write after the hold lifts still lands after the ones held", () => {
    const p = page();
    p.held.add("c1");
    p.writes.write("c1", (e) => e.insert("first"));
    p.held.delete("c1");
    p.writes.write("c1", (e) => e.insert(" second"));
    expect(p.state.text).toBe("");
    p.writes.flush();
    expect(p.state.text).toBe("first second");
  });

  it("keeps a held chapter's words until the writer is back on that chapter", () => {
    const p = page();
    p.held.add("c1");
    p.writes.write("c1", (e) => e.insert("kept"));
    p.held.delete("c1");
    p.state.showing = "c2";
    p.writes.flush();
    expect(p.state.text).toBe("");
    p.state.showing = "c1";
    p.writes.flush();
    expect(p.state.text).toBe("kept");
  });
});
