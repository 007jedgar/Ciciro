import { createExecuTorchRuntime, kokoroConfigFor } from "../lib/natural-runtime-executorch";
import { KOKORO_FILES, PHONEMIZER_FILES } from "../lib/natural-pack";
import { naturalVoiceById, NATURAL_VOICES, type NaturalVoice } from "../lib/natural-voice";

const DIR = "/data/natural/pack/files";
const voice = (id: string) => naturalVoiceById(id) as NaturalVoice;

type Config = ReturnType<typeof kokoroConfigFor>;

/** A stand-in for react-native-executorch: every instance records what it was told. */
function fakeApi(opts: { chunks?: number[][]; createFails?: boolean } = {}) {
  const log = {
    configs: [] as Config[],
    synthesized: [] as Array<{ text: string; voice: string; speed: number }>,
    stops: 0,
    disposed: 0,
  };
  const api = {
    async createKokoroTextToSpeech(config: Config) {
      if (opts.createFails) throw new Error("the model would not load");
      log.configs.push(config);
      return {
        async *synthesize(text: string, options: { voice: string; speed: number }) {
          log.synthesized.push({ text, ...options });
          for (const chunk of opts.chunks ?? [[0.1, 0.2, 0.3]]) {
            yield { audio: new Float32Array(chunk), sampleRate: 24_000 };
          }
        },
        synthesizeStop() {
          log.stops++;
        },
        dispose() {
          log.disposed++;
        },
      };
    },
  };
  return { api, log };
}

describe("kokoroConfigFor", () => {
  it("points the shared models and the language's own phonemizer files into the pack's folder", () => {
    const config = kokoroConfigFor(DIR, "en-us");
    expect(config.name).toBe("kokoro");
    expect(config.modelPaths).toEqual({
      durationPredictor: `${DIR}/${KOKORO_FILES.durationPredictor.path}`,
      synthesizer: `${DIR}/${KOKORO_FILES.synthesizer.path}`,
    });
    expect(config.phonemizer).toEqual({
      lang: "en-us",
      taggerSource: `${DIR}/${KOKORO_FILES.enTags.path}`,
      lexiconSource: `${DIR}/${KOKORO_FILES.enUsLexicon.path}`,
      neuralModelSource: `${DIR}/${KOKORO_FILES.enUsPhonemizer.path}`,
    });
  });

  it("gives UK English its own lexicon and network but the one shared tagger", () => {
    const us = kokoroConfigFor(DIR, "en-us").phonemizer;
    const gb = kokoroConfigFor(DIR, "en-gb").phonemizer;
    expect(gb.taggerSource).toBe(us.taggerSource);
    expect(gb.lexiconSource).not.toBe(us.lexiconSource);
    expect(gb.neuralModelSource).not.toBe(us.neuralModelSource);
  });

  it("gives Spanish and Hindi only their network (no tagger or lexicon)", () => {
    for (const lang of ["es", "hi"] as const) {
      const { phonemizer } = kokoroConfigFor(DIR, lang);
      expect(phonemizer).toEqual({ lang, neuralModelSource: `${DIR}/${PHONEMIZER_FILES[lang].neural}` });
    }
  });

  it("lists only the voices that language speaks", () => {
    const voices = (g2p: Parameters<typeof kokoroConfigFor>[1]) => Object.keys(kokoroConfigFor(DIR, g2p).voices).sort();
    expect(voices("en-us")).toEqual(["af_heart", "af_sarah"]);
    expect(voices("en-gb")).toEqual(["bf_emma"]);
    expect(voices("es")).toEqual(["ef_dora"]);
    expect(voices("hi")).toEqual(["hf_alpha"]);
    expect(kokoroConfigFor(DIR, "es").voices.ef_dora).toBe(`${DIR}/${KOKORO_FILES.voices.ef_dora.path}`);
  });

  it("covers every offered voice exactly once across the phonemizers", () => {
    const all = (["en-us", "en-gb", "es", "hi"] as const).flatMap((g) => Object.keys(kokoroConfigFor(DIR, g).voices));
    expect(all.sort()).toEqual(NATURAL_VOICES.map((v) => v.id).sort());
  });
});

describe("the ExecuTorch runtime", () => {
  it("refuses to load a model that is not installed", async () => {
    const { api, log } = fakeApi();
    const runtime = createExecuTorchRuntime({ modelPath: () => null, api });
    await expect(runtime.load(voice("af_heart"))).rejects.toThrow(/not installed/);
    expect(log.configs).toEqual([]);
  });

  it("loads once per phonemizer and not again for a second voice that shares it", async () => {
    const { api, log } = fakeApi();
    const runtime = createExecuTorchRuntime({ modelPath: () => DIR, api });
    await runtime.load(voice("af_heart"));
    await runtime.load(voice("af_sarah"));
    await runtime.load(voice("af_heart"));
    expect(log.configs).toHaveLength(1);
    expect(log.configs[0].phonemizer.lang).toBe("en-us");
  });

  it("swaps to the other phonemizer for a voice in another language, freeing the first instance", async () => {
    const { api, log } = fakeApi();
    const runtime = createExecuTorchRuntime({ modelPath: () => DIR, api });
    await runtime.load(voice("af_heart"));
    await runtime.load(voice("ef_dora"));
    expect(log.configs.map((c) => c.phonemizer.lang)).toEqual(["en-us", "es"]);
    expect(log.disposed).toBe(1);
    expect(log.stops).toBe(1);
    // The Spanish instance is the one that reads now, and the English voice needs a reload.
    await expect(runtime.synthesize("Hola.", { voice: voice("af_heart"), speed: 1 })).rejects.toThrow(/not loaded/);
    await expect(runtime.synthesize("Hola.", { voice: voice("ef_dora"), speed: 1 })).resolves.toBeDefined();
  });

  it("will not synthesise before a load", async () => {
    const { api } = fakeApi();
    const runtime = createExecuTorchRuntime({ modelPath: () => DIR, api });
    await expect(runtime.synthesize("Hello.", { voice: voice("af_heart"), speed: 1 })).rejects.toThrow(/not loaded/);
  });

  it("passes the voice id and speed through and returns the samples with their rate", async () => {
    const { api, log } = fakeApi({ chunks: [[0.25, -0.5]] });
    const runtime = createExecuTorchRuntime({ modelPath: () => DIR, api });
    await runtime.load(voice("bf_emma"));
    const out = await runtime.synthesize("Good morning.", { voice: voice("bf_emma"), speed: 1.25 });
    expect(log.synthesized).toEqual([{ text: "Good morning.", voice: "bf_emma", speed: 1.25 }]);
    expect(Array.from(out.samples)).toEqual([0.25, -0.5]);
    expect(out.sampleRate).toBe(24_000);
  });

  it("joins the pieces of a long sentence in order", async () => {
    const { api } = fakeApi({ chunks: [[1, 2], [3], [4, 5, 6]] });
    const runtime = createExecuTorchRuntime({ modelPath: () => DIR, api });
    await runtime.load(voice("af_heart"));
    const out = await runtime.synthesize("A long sentence.", { voice: voice("af_heart"), speed: 1 });
    expect(Array.from(out.samples)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("clamps the speed to what the model accepts", async () => {
    const { api, log } = fakeApi();
    const runtime = createExecuTorchRuntime({ modelPath: () => DIR, api });
    await runtime.load(voice("af_heart"));
    await runtime.synthesize("Fast.", { voice: voice("af_heart"), speed: 9 });
    await runtime.synthesize("Slow.", { voice: voice("af_heart"), speed: 0 });
    expect(log.synthesized.map((s) => s.speed)).toEqual([3, 0.1]);
  });

  it("returns a beat of silence for a sentence the model has nothing to say for", async () => {
    const { api } = fakeApi({ chunks: [] });
    const runtime = createExecuTorchRuntime({ modelPath: () => DIR, api });
    await runtime.load(voice("af_heart"));
    const out = await runtime.synthesize("...", { voice: voice("af_heart"), speed: 1 });
    expect(out.samples.length).toBe(1200);
    expect(out.samples.every((v) => v === 0)).toBe(true);
    expect(out.sampleRate).toBe(24_000);
  });

  it("copies the samples out of the chunk, which the library may reuse", async () => {
    const shared = new Float32Array([0.5, 0.5]);
    const api = {
      async createKokoroTextToSpeech() {
        return {
          async *synthesize() {
            yield { audio: shared, sampleRate: 24_000 };
            shared.fill(0);
          },
          synthesizeStop() {},
          dispose() {},
        };
      },
    };
    const runtime = createExecuTorchRuntime({ modelPath: () => DIR, api });
    await runtime.load(voice("af_heart"));
    const out = await runtime.synthesize("Hi.", { voice: voice("af_heart"), speed: 1 });
    expect(Array.from(out.samples)).toEqual([0.5, 0.5]);
  });

  it("frees the model on release, and loads it again afterwards", async () => {
    const { api, log } = fakeApi();
    const runtime = createExecuTorchRuntime({ modelPath: () => DIR, api });
    await runtime.load(voice("af_heart"));
    await runtime.release();
    expect(log.disposed).toBe(1);
    await runtime.release();
    expect(log.disposed).toBe(1);
    await runtime.load(voice("af_heart"));
    expect(log.configs).toHaveLength(2);
  });

  it("lets a failed load be tried again", async () => {
    const failing = fakeApi({ createFails: true });
    const runtime = createExecuTorchRuntime({ modelPath: () => DIR, api: failing.api });
    await expect(runtime.load(voice("af_heart"))).rejects.toThrow(/would not load/);
    await expect(runtime.synthesize("Hi.", { voice: voice("af_heart"), speed: 1 })).rejects.toThrow(/not loaded/);
  });
});
