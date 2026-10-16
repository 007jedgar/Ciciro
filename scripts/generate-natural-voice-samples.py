#!/usr/bin/env python3
"""Regenerates the natural-voice sample clips the phone plays before the model is downloaded.

    uv venv /tmp/kokoro-venv && uv pip install --python /tmp/kokoro-venv/bin/python onnxruntime numpy
    /tmp/kokoro-venv/bin/python scripts/generate-natural-voice-samples.py \
        --onnx /path/to/kokoro-multi-lang-v1_0 \
        --voices /path/to/hf-pack  --phonemis /path/to/Phonemis \
        --out apps/mobile/assets/voice-samples

The app reads Kokoro through react-native-executorch, which runs an ExecuTorch export of the
model; there is no ExecuTorch runtime on a laptop, so the clips are made from the same Kokoro
v1.0 weights as an ONNX file, with exactly what the app uses for everything else:

  --onnx      the unpacked sherpa-onnx `kokoro-multi-lang-v1_0` pack (`model.onnx`, `tokens.txt`), the
              fp32 ONNX export of Kokoro-82M v1.0 (the pack is only used for the model and the symbol
              table, not downloaded by the app)
  --voices    a folder with the pack's files laid out as the app's download is (`voices/<id>.bin`,
              `phonemizer/en-us/{lexicon,tags}.json`, `phonemizer/en-gb/lexicon.json`), from the
              Hugging Face repo software-mansion/react-native-executorch-kokoro at `v0.10.0`
  --phonemis  a checkout of github.com/IgorSwat/Phonemis built with CMake (`build/phonemis_runner`),
              whose `data/*/phonemizer_*.bin` are the same networks as the app's `.pte` files

The voice vectors are the same numbers as Kokoro's own (checked bit for bit against the sherpa
pack's table), the text goes through the same Phonemis G2P, and the style row is picked like the
app's (the phoneme count minus one). What differs is the ExecuTorch export's own small changes to
the vocoder, which do not change the voice. ffmpeg (with libmp3lame) must be on PATH. Re-run it, and
`--check`, whenever a voice or a sample sentence changes, then update NATURAL_VOICES in
apps/mobile/lib/natural-voice.ts and the require list in apps/mobile/lib/natural-voice-samples.ts.

Each clip says the same plain sentence in its language (no invented names the model would
mispronounce), is trimmed of silence, levelled to -18 LUFS and encoded as 24 kHz mono MP3 at
40 kbps, about 5 seconds and 25 to 35 KB. The script refuses to write a clip that is silent
(an audio filter once faded every clip to nothing, and a file that exists is not a file that
plays).
"""
import argparse
import re
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

# (voice id, phonemizer, sentence). Keep in step with NATURAL_VOICES.
SENTENCES = {
    "en": "The morning was cold and the sea was calm, so we left early for the island.",
    "es": "La mañana era fría y el mar estaba tranquilo, así que salimos temprano hacia la isla.",
    # No ड़ or ढ़: Phonemis' Hindi network mishandles those two letters.
    "hi": "नाव सुबह जल्दी रवाना हुई और किसी ने कुछ नहीं कहा।",
}
VOICES = [
    ("af_heart", "en-us", "en"),
    ("af_sarah", "en-us", "en"),
    ("bf_emma", "en-gb", "en"),
    ("ef_dora", "es", "es"),
    ("hf_alpha", "hi", "hi"),
]

# Trim leading and trailing silence, then level. No fades: a mis-set one silenced the whole clip.
FILTER = (
    "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,"
    "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,"
    "loudnorm=I=-18:TP=-2:LRA=7"
)
MIN_MEAN_DB = -30.0


ANSI = re.compile(r"\x1b\[[0-9;]*m")


def phonemize(phonemis: Path, voices: Path, g2p: str, text: str) -> str:
    """Phonemis' own command line, set up with the files the app downloads."""
    args = {
        "en-us": ["--lexicon", voices / "phonemizer/en-us/lexicon.json", "--tagger", voices / "phonemizer/en-us/tags.json",
                  "--model", phonemis / "data/en-us/phonemizer_en_us.bin"],
        "en-gb": ["--lexicon", voices / "phonemizer/en-gb/lexicon.json", "--tagger", voices / "phonemizer/en-us/tags.json",
                  "--model", phonemis / "data/en-gb/phonemizer_en_gb.bin"],
        "es": ["--model", phonemis / "data/es/phonemizer_es.bin"],
        "hi": ["--model", phonemis / "data/hi/phonemizer_hi.bin"],
    }[g2p]
    run = subprocess.run(
        [str(phonemis / "build/phonemis_runner"), "--lang", g2p, *map(str, args), text],
        capture_output=True, text=True, cwd=phonemis, check=True,
    )
    for line in run.stdout.splitlines():
        line = ANSI.sub("", line)
        if line.startswith("Output:"):
            return line[len("Output:"):].strip()
    sys.exit(f"Phonemis printed no phonemes for {text!r}:\n{run.stdout}{run.stderr}")


def symbol_table(tokens: Path) -> dict:
    table = {}
    for line in tokens.read_text(encoding="utf8").splitlines():
        parts = line.rstrip("\n").rsplit(" ", 1)
        if len(parts) == 2:
            table[parts[0]] = int(parts[1])
    return table


def synthesize(onnx: Path, voices: Path, phonemis: Path, out_wav: Path, voice: str, g2p: str, text: str) -> None:
    import numpy as np
    import onnxruntime as ort

    table = symbol_table(onnx / "tokens.txt")
    phonemes = [ch for ch in phonemize(phonemis, voices, g2p, text) if ch in table]
    if len(phonemes) < 10:
        sys.exit(f"{voice}: Phonemis gave almost nothing to say for {text!r}")
    ids = [0] + [table[ch] for ch in phonemes] + [0]
    # Kokoro's own choice of style row: the number of phonemes, less one.
    style = np.fromfile(voices / "voices" / f"{voice}.bin", dtype=np.float32).reshape(-1, 256)
    row = style[min(len(phonemes) - 1, len(style) - 1)].reshape(1, 256)
    session = ort.InferenceSession(str(onnx / "model.onnx"), providers=["CPUExecutionProvider"])
    audio = session.run(None, {"tokens": np.array([ids], dtype=np.int64), "style": row, "speed": np.array([1.0], dtype=np.float32)})[0]
    pcm = (np.clip(audio.reshape(-1), -1, 1) * 32767).astype(np.int16)
    with wave.open(str(out_wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(pcm.tobytes())


def mean_volume_db(path: Path) -> float:
    """ffmpeg's volumedetect on the clip as it will be played."""
    run = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
        capture_output=True,
        text=True,
    )
    match = re.search(r"mean_volume: (-?[\d.]+) dB", run.stderr)
    return float(match.group(1)) if match else float("-inf")


def check(out: Path) -> bool:
    ok = True
    for voice, _, _ in VOICES:
        clip = out / f"{voice}.mp3"
        level = mean_volume_db(clip) if clip.exists() else float("-inf")
        verdict = "ok" if level > MIN_MEAN_DB else "SILENT OR MISSING"
        print(f"{voice}: mean {level:.1f} dB, {clip.stat().st_size if clip.exists() else 0} bytes, {verdict}")
        ok &= level > MIN_MEAN_DB
    return ok


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--onnx", type=Path, help="the unpacked kokoro-multi-lang-v1_0 folder (model.onnx, tokens.txt)")
    parser.add_argument("--voices", type=Path, help="the app's pack files (voices/, phonemizer/)")
    parser.add_argument("--phonemis", type=Path, help="a built Phonemis checkout")
    parser.add_argument("--out", type=Path, required=True, help="where the clips go")
    parser.add_argument("--check", action="store_true", help="only verify the clips already in --out are audible")
    args = parser.parse_args()

    if args.check:
        sys.exit(0 if check(args.out) else 1)
    if not (args.onnx and args.voices and args.phonemis):
        parser.error("--onnx, --voices and --phonemis are required unless --check")
    args.out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for voice, g2p, language in VOICES:
            wav = Path(tmp) / f"{voice}.wav"
            synthesize(args.onnx, args.voices, args.phonemis, wav, voice, g2p, SENTENCES[language])
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-af", FILTER,
                 "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "40k", str(args.out / f"{voice}.mp3")],
                check=True,
            )
    if not check(args.out):
        sys.exit("a clip is silent: do not ship it")


if __name__ == "__main__":
    main()
