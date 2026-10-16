# Natural voice (on-device Kokoro)

Listen on the phone has two engines. The **system voice** (expo-speech) is the
default and needs nothing. The **natural voice** is Kokoro-82M running on the
phone: the writer opts in under Settings, Listening, downloads the model once (about 380 MB),
and from then on a chapter in English, Spanish or Hindi is read by it. No text
ever leaves the phone and there is no cloud tier. Web Listen is unchanged.

## What the writer gets

- Settings, **Listening** (and the voice row on the Listen screen) opens
  `app/listening.tsx`: the choice between the two engines, the download (size
  shown, Wi-Fi guidance, a prompt on mobile data, progress as a closing ring,
  Pause, Resume, Cancel, Delete), the natural voices with a bundled sample of
  each (they play before anything is downloaded), the system voice picker, and
  the saved audio with a clear button.
- Until the model is on the phone the system voice reads. Once it is, the natural
  voice reads unless the writer chose the system voice. A chapter in any other
  language (Mandarin, French, ...) is read by the system voice: Kokoro grades
  every Mandarin voice D, and Listen offers no voice for the other languages.
- If the natural voice cannot keep up, or fails, the system voice carries on from
  the sentence it stopped at and a line says so. `natural_voice_fallback` records
  why (and only why).
- Playback is gapless, survives the screen locking (iOS `audio` background mode,
  Android media foreground service) and shows Play and Pause on the lock screen.
  On Android 13+ that card is a notification, so it appears only when Ciciro
  already has notification permission (the writing reminders ask for it); Listen
  never prompts for it on its own, because a system dialog the moment Play is
  pressed has no context. Neither the card nor background playback was verified
  on a real phone.

## Source and licence

| | |
|---|---|
| Model | Kokoro-82M v1.0 (hexgrad), full precision (fp32), exported for ExecuTorch (XNNPACK) by Software Mansion; one synthesizer serves every language Listen offers |
| Source | Hugging Face, `software-mansion/react-native-executorch-kokoro`, pinned to the revision `v0.10.0`: `https://huggingface.co/software-mansion/react-native-executorch-kokoro/tree/v0.10.0` (files at `.../resolve/v0.10.0/<path>`) |
| Files | 14 files, 380,076,203 bytes in all: the duration predictor (59 MB) and synthesizer (272 MB), a 7 to 9 MB phonemizer network for each of US English, UK English, Spanish and Hindi, the English lexicons and tagger (15 MB), and five 0.5 MB voice files. Exact paths and sizes are in `lib/natural-pack.ts` |
| Model licence | Apache-2.0 (the repository's model card) |
| Phonemizer | Phonemis (`github.com/IgorSwat/Phonemis`), MIT, linked into react-native-executorch |
| Runtime | `react-native-executorch` 0.10.5 (MIT), ExecuTorch and XNNPACK (BSD-3-Clause) |
| Voice files | read through `react-native-blob-util` (MIT), which executorch needs |
| Audio | `react-native-audio-api` 0.13.6 (MIT), FFmpeg switched off in `app.json` (the bundled MP3 samples decode without it) |

Nothing in the app or the download is GPL. The model is never bundled in the
binary: it downloads on demand, from that URL, as the raw files (nothing to
unpack) in 8 MiB ranged chunks that resume (`lib/natural-model.ts`, Hugging Face
answers a `Range` request with a 206 through its redirect), into the app's
cache folder (`lib/natural-model-store.ts`; kept out of backups, at the cost that
"Clear cache" can remove it, after which the screen offers the download again).
The download is the only outside request the feature makes.

Version lock: ExecuTorch model files have no forward compatibility. The files at
`v0.10.0` are the ones react-native-executorch 0.10.5 itself downloads, and
`package.json` pins that library to exactly `0.10.5`. Move them together, and
keep the library's `react-native-executorch` block in `package.json`
(`backends: ["xnnpack"]`, `libs: ["phonemis"]`, with `allowScripts` so its
postinstall fetches the native libraries) in step.

Changing the pack: edit `lib/natural-pack.ts` (a new `id`, since it names the
folder and is part of every saved sentence's key, plus the byte sizes and the
required files), and update the figures here.

### What was swapped out, and one open question

The first build of this feature ran Kokoro through sherpa-onnx. That library
links **eSpeak NG (GPL-3.0-or-later)** statically on both platforms and has no
build switch to leave it out, which is not something to ship in a closed-source
app. The runtime was replaced behind the `NaturalRuntime` seam
(`lib/kokoro-engine.ts`) with react-native-executorch, whose phonemizer,
Phonemis, is MIT. Nothing else in the app changed shape.

Open follow-up, not asked of anyone yet: the Phonemis repository does not say
where its English lexicon (a port of the MIT misaki one) or the training data of
its neural networks (Spanish and Hindi, and the English fallback for unknown
words) come from. Weights trained on the output of a GPL program are not
themselves GPL as far as we know, but nobody has confirmed it. If counsel wants
that on file, ask Software Mansion in writing. This is engineering notes, not
legal advice.

## Why this runtime and this pack (measurements)

Both runtimes were built into a scratch app (never in this repo), in Release, on
RN 0.86.3 / Expo 57, and ran six sentences twice through each configuration, on an
**iOS simulator** (iPhone 17) and an **Android emulator** (Pixel_9, arm64-v8a,
API 36, 4 GB). **Real-device performance was not measured.** Both ran on an
M1 Pro laptop, so the absolute numbers are laptop-class: a phone's CPU is
slower, the Android emulator is hardware-virtualised arm64 rather than a phone,
and the memory figures are the simulator process's RSS (iOS) and the guest's PSS
(Android). What carries over is the comparison between configurations.

Real-time factor (RTF) is synthesis time over audio length (under 1 keeps up),
warm pass, mean and p95; first audio is the first sentence (about six seconds of
speech) from request to samples; peak memory includes the app's idle baseline
(288 MB RSS on iOS, 80 MB PSS on Android).

| iOS simulator | RTF mean / p95 | first audio | peak RSS |
|---|---|---|---|
| sherpa int8, 4 threads | 0.72 / 0.95 | 3.9 s | 853 MB |
| sherpa fp32, 4 threads | 0.30 / 0.38 | 1.6 s | 1050 MB |
| **executorch fp32 XNNPACK** | **0.31 / 0.38** | **1.7 s** | 1243 MB |

| Android emulator | RTF mean / p95 | first audio | peak PSS |
|---|---|---|---|
| sherpa int8, 4 threads | 0.78 / 0.97 | 4.3 s | 680 MB |
| sherpa fp32, 4 threads | 0.35 / 0.43 | 1.9 s | 843 MB |
| **executorch fp32 XNNPACK** | **0.39 / 0.48** | **2.1 s** | 1019 MB |

What the numbers say:

- **executorch is as fast as sherpa's fp32 pack** (0.31 and 0.30 on iOS, 0.39 and
  0.35 on Android). Its price is memory: about 190 MB more at the peak. Tight on
  a 3 to 4 GB phone; the engine frees the model after 45 s idle, and a chapter
  heard before is answered from the saved audio without loading it at all.
- **int8 is not a way to a smaller download yet.** sherpa's int8 files are 2.4
  times slower than fp32 (RTF 0.7 to 0.85, which a phone would not keep up with),
  because of the onnxruntime inside sherpa and inside the official React Native
  package (1.24). Plain onnxruntime 1.31 (released 2026-10-09) runs the same int8
  Kokoro at RTF 0.11, twice as fast as fp32, on a laptop. A runtime built on it
  would cut the download to roughly 92 to 114 MB; that is a different
  `NaturalRuntime` behind the same seam, and was not built.
- **One download covers three languages.** The ExecuTorch "standard" synthesizer
  serves US and UK English, Spanish and Hindi (and French, Italian and
  Portuguese, which Listen does not offer); each language adds a 7 to 9 MB
  phonemizer.
- **Quality of the sounds, by speech recognition, not by ear.** The same Kokoro
  weights read back through Whisper `small` (character similarity to the text,
  one voice per language, a handful of sentences with invented names), Phonemis
  against sherpa's eSpeak NG: English 0.954 against 0.958, Hindi 0.915 against
  0.918, Spanish 0.982 against 0.833 (sherpa as the first build configured it
  mispronounced most Spanish sentences, because its React Native wrapper does not
  pass the language). Names are slightly worse with Phonemis (0.82 against 0.86 on
  "Xochitl and Siobhan walked to Llanelli").
- **OS minimums.** react-native-executorch needs iOS 17.0 and Android 26; the app
  was iOS 16.4 and Android 24. `app.json` raises both through `expo-build-properties`.
  Android ships `arm64-v8a` and `x86_64` libraries only; on a 32-bit-only phone the
  package falls back to a module that reports itself unavailable, so Listen reads
  with the system voice (from the package's code, not tested on such a phone).

**In the real app** (the Debug dev client built with executorch, a fresh install on the
iOS simulator and the Android emulator, the model downloaded through the Listening
screen from Hugging Face, then Listen on the seeded chapters; none of it on a phone,
both on the M1 Pro host). RTF is the engine's own `natural_voice_read_finished` figure
for the whole read, first audio includes loading the model for that read, and no read
had an underrun:

| | English (Heart) | UK English (Emma) | Spanish (Dora) | Hindi (Alpha) | the same chapter again |
|---|---|---|---|---|---|
| iOS simulator | RTF 0.44, 3.7 s | RTF 0.44, 3.5 s | RTF 0.36, 2.3 s | RTF 0.29, 1.5 s | 36 ms, no model load |
| Android emulator | RTF 0.60, 5.4 s | not run | RTF 0.50, 3.3 s | RTF 0.50, 4.0 s | 119 ms, no model load |

The first sentence's wait is mostly the model loading (the first read after the app
starts or after the 45 s idle release). The sherpa build this replaced measured
iOS RTF 0.29 and Android 0.54 on the English chapter, so executorch is a little
slower in the real app than in the scratch benchmark above (Debug build, JS
bridge in the loop); still well under 1 on a laptop. Memory (process RSS on
iOS, PSS on Android, Debug dev client): the app idles at about 0.98 GB RSS on iOS
and 1.0 GB PSS (0.6 GB RSS) on Android, rises to 1.6 to 1.76 GB RSS on iOS and 2.0 GB
PSS (1.2 GB RSS) on Android while the model is loaded, and falls back to the idle
figure once the engine releases it after 45 s. That peak is the main risk on a
3 to 4 GB phone and has not been measured on one. The download itself took about 50 s
on the iOS simulator (laptop broadband, including a Pause and a Resume at 50 %) and a few
minutes on the emulator's virtual network; 14 files, 380,076,203 bytes, checked by size.
Pause kept the whole chunks and Resume carried on from them; Delete removed every file;
the install survived an app restart.

Two things the device runs found in code outside the voice itself, both fixed here:

- The sentence splitter did not know the Hindi danda (`।`), so a Hindi paragraph was
  read, and highlighted, as one long sentence. `splitSentences` now ends a sentence at
  `।` and `॥` (`lib/read-aloud.ts`).
- Android's native editor saves every non-ASCII letter as a numeric entity
  (`ma&#241;ana`), and `htmlToText` / `htmlToPlainText` decoded only a few named
  entities, so Read aloud showed and spoke `&#241;` on Android for any Spanish or
  Hindi chapter. Both now decode numeric entities (`src/lib/text.ts`,
  `apps/mobile/lib/html.ts`), which also cleans the text the assistant reads.

Not checked on a device: the lock-screen card and background playback, the Android
notification card, the fallback to the system voice with the new runtime (covered by
the engine's unit tests and by the first build's run), and Cancel mid-download on the
new pack (state-machine tests only).

## How it fits together

Pure, tested without a device (the native pieces sit behind small interfaces):

- `lib/natural-voice.ts`: the voice catalog (`NATURAL_VOICES`; ids are permanent,
  they are stored and carried by analytics), which phonemizer speaks each voice
  (`phonemizerFor`), `detectTextLanguage` (script share and stopword votes, so
  Mandarin or French never gets an English voice) and `chooseSpeechEngine` (the
  one rule for who reads).
- `lib/kokoro-engine.ts`: the `SpeechEngine` for a whole read (`playRun`). It
  loads the model (`NaturalRuntime.load(voice)`) only at the first sentence the
  saved audio cannot answer (a chapter heard before never loads it), synthesises
  two sentences ahead of the one being heard, one at a time, hands
  them to a gapless queue, answers repeats from the saved audio, and gives up
  cleanly when the phone cannot keep up (real-time factor above 1.1, two stalls
  over 1.2 s, a first sentence slower than 15 s, or a failure): the queued audio
  still plays out, then the reader moves to the system voice.
- `lib/read-aloud.ts`: `SentenceReader` hands an engine with `playRun` the rest of
  the read, and a `fallback` engine takes over from the sentence it stopped at.
- `lib/sentence-cache.ts`: saved sentences as PCM16 files keyed by model,
  voice, speed and text, capped at 200 MiB (about 70 minutes), oldest first.
- `lib/natural-model.ts`: the download state machine and installer (disk-space
  check with a 100 MB margin over the download plus the largest file joined whole,
  per-chunk retry, pause, cancel, delete, each file joined from its chunks and
  moved into its folder, an `installed.json` marker written last so a half install
  is never "ready").

Native, thin:

- `lib/natural-runtime-executorch.ts`: Kokoro through react-native-executorch
  (`createKokoroTextToSpeech`, one sentence per call, on ExecuTorch's own thread,
  never the JS thread). One loaded instance serves one phonemizer, so a voice in
  another language reloads the model; a chapter is in one language, so that is rare.
- `lib/natural-audio-output.ts`: `react-native-audio-api`'s buffer queue
  (gapless), the lock-screen card, and the sample clips.
- `lib/natural-engine.ts`: wires the above once, lazily. Where a native piece is
  missing (web, an older dev client, tests) `naturalNativeAvailable()` is false
  and Listen simply reads with the system voice.

## Voices and samples

Offered: `af_heart`, `af_sarah` (American), `bf_emma` (British), `ef_dora`
(Spanish), `hf_alpha` (Hindi). English voices are Kokoro's best-graded ones the
runtime ships. **Which voices exist depends on the runtime**: sherpa's pack has 54
voices including `af_bella`; ExecuTorch's repository has a smaller set without it,
so `af_sarah` took its place when the runtime changed. A voice with a new runtime
needs a voice file in `lib/natural-pack.ts`, an entry in `NATURAL_VOICES` and a
sample clip, and a test pins that all three agree. A voice id that is no longer
offered quietly falls back to the language's default.

The Spanish and Hindi voices were chosen by a speech-recognition round trip
(Whisper small reading the clips back), not by ear: the English, Spanish clips
read back at 1.00 and the Hindi one at 0.99. **Nobody has yet auditioned Spanish
and Hindi by ear**; either is a one-line removal from `NATURAL_VOICES`.

The five clips in `apps/mobile/assets/voice-samples/` (about four seconds each,
107 KB in all) are made from the same Kokoro weights that are downloaded, with the
same Phonemis phonemizer and the same voice vectors. There is no ExecuTorch
runtime on a laptop, so the clips run the weights as an ONNX file; the
ExecuTorch export differs from it only in small changes to the vocoder. Regenerate
them whenever a voice or a sample sentence changes:

```bash
uv venv /tmp/kokoro-venv && uv pip install --python /tmp/kokoro-venv/bin/python onnxruntime numpy
/tmp/kokoro-venv/bin/python scripts/generate-natural-voice-samples.py \
  --onnx /path/to/kokoro-multi-lang-v1_0 --voices /path/to/hf-pack \
  --phonemis /path/to/Phonemis --out apps/mobile/assets/voice-samples
/tmp/kokoro-venv/bin/python scripts/generate-natural-voice-samples.py --out apps/mobile/assets/voice-samples --check
```

(`--onnx` is the unpacked sherpa-onnx `kokoro-multi-lang-v1_0` pack, used only for
`model.onnx` and `tokens.txt`; `--voices` is the Hugging Face repository at `v0.10.0`;
`--phonemis` is a CMake build of Phonemis. The script's header says the rest.)

The script refuses to write a silent clip. (A filter once faded the first batch
to nothing: the files existed and had the right size, and a plain check of "does
the file exist" cannot tell.)

## Analytics and privacy

Events (both catalogs, `docs/analytics.md`): `listening_engine_chosen`,
`natural_voice_chosen`, `natural_voice_sample_played`, the download's
`started` / `completed` / `failed` / `canceled`, `natural_voice_deleted`,
`natural_voice_read_finished` (how the read ended, first-audio time, real-time factor, underruns and
counts, which is how real-phone speed gets measured after release) and
`natural_voice_fallback`. None carries text.

Saved sentences are the author's prose as audio: they live in the cache folder,
are cleared by Clear saved audio, deleting the voice and deleting the account
(`forgetAccountOnDevice`), and never sync.

## Native build

This adds native modules (`react-native-executorch`, `react-native-blob-util`,
`react-native-audio-api`, `expo-build-properties`) and config-plugin changes (iOS
17.0 deployment target, Android `minSdkVersion` 26, iOS `audio` background mode,
Android media foreground service), so the runtime fingerprint changes: it
needs a new binary (`docs/mobile-release.md`), never an over-the-air update. An
older binary never gets this JavaScript, so there is no half-working state.
