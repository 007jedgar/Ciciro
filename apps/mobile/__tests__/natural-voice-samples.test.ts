import { readFileSync, statSync } from "fs";
import { join } from "path";
import { NATURAL_VOICES } from "../lib/natural-voice";
import { sampleFor } from "../lib/natural-voice-samples";

const DIR = join(__dirname, "..", "assets", "voice-samples");

describe("the bundled voice samples", () => {
  it.each(NATURAL_VOICES.map((v) => v.id))("%s has a sample the screen can play", (id) => {
    expect(sampleFor(id)).not.toBeNull();
  });

  it("has no sample for a voice that is not offered", () => {
    expect(sampleFor("am_adam")).toBeNull();
  });

  it.each(NATURAL_VOICES.map((v) => v.id))("%s is a small MP3, not an empty or renamed file", (id) => {
    const file = join(DIR, `${id}.mp3`);
    const bytes = statSync(file).size;
    // Four to six seconds at 40 kbps: a few tens of kilobytes, and nothing like a 130 MB model.
    expect(bytes).toBeGreaterThan(8_000);
    expect(bytes).toBeLessThan(80_000);
    const head = readFileSync(file).subarray(0, 3);
    const isId3 = head.toString("latin1") === "ID3";
    const isFrame = head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
    expect(isId3 || isFrame).toBe(true);
  });

  it("covers exactly the offered voices", () => {
    const files = require("fs").readdirSync(DIR).filter((f: string) => f.endsWith(".mp3")).sort();
    expect(files).toEqual(NATURAL_VOICES.map((v) => `${v.id}.mp3`).sort());
  });
});
