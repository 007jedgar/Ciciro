import { useTranslation } from "react-i18next";
import { naturalNativeAvailable } from "./natural-engine";
import { useNaturalModelState } from "./natural-model-store";
import { chooseSpeechEngine, detectTextLanguage, naturalVoiceName } from "./natural-voice";
import { useReadAloudPrefs } from "./read-aloud";
import { deviceLocale } from "./system-voices";

/** Who reads aloud right now, as the one line Settings shows beside "Voice". */
export function useListeningSummary(): string {
  const { t } = useTranslation();
  const prefs = useReadAloudPrefs();
  const model = useNaturalModelState();
  const choice = chooseSpeechEngine({
    preferred: prefs.engine,
    modelReady: model.status === "ready",
    nativeAvailable: naturalNativeAvailable(),
    // No text to read yet: the voice the phone's own language would get.
    language: detectTextLanguage("", deviceLocale()),
    voices: prefs.naturalVoices,
  });
  return choice.kind === "natural"
    ? t("listening.summaryNatural", { name: naturalVoiceName(choice.voice.id) })
    : t("listening.summarySystem");
}
