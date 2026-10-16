import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "../lib/settings";
import { useFade } from "../lib/use-fade";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { alpha } from "./Glass";
import { fonts } from "../lib/theme";
import { blocksPlainText } from "../lib/read-aloud-text";
import {
  expoSpeechEngine,
  lineYForOffset,
  RATE_STEPS,
  readAloudScrollTarget,
  readAloudSentences,
  SentenceReader,
  setReadAloudPrefs,
  useReadAloudPrefs,
  voiceChoices,
  type ReaderState,
  type ReadAloudPrefs,
  type SpeechEngine,
  type VoiceOption,
} from "../lib/read-aloud";
import { announce } from "../lib/announce";
import { getAnalytics } from "../lib/analytics-client";
import { getNaturalAudioOutput } from "../lib/natural-audio-output";
import { getNaturalEngine, naturalNativeAvailable, onNaturalEngineEvent } from "../lib/natural-engine";
import { naturalModelState, useNaturalModelState } from "../lib/natural-model-store";
import { chooseSpeechEngine, detectTextLanguage, naturalVoiceName } from "../lib/natural-voice";
import { deviceLocale, loadSystemVoices } from "../lib/system-voices";
import { TapPressable } from "./TapPressable";
import { PRESS_SCALE } from "../lib/motion";

export type ReadAloudVoice = VoiceOption;

/** The highlight eases in and out over this long as the reading moves on. */
const HIGHLIGHT_MS = 150;

/** One sentence of the page, its highlight fading in while it is read and out when it is done. */
function Sentence({ on, color, children }: { on: boolean; color: string; children: string }) {
  const reduceMotion = useReduceMotion();
  const level = useFade(on ? 1 : 0, HIGHLIGHT_MS, !reduceMotion);
  return (
    <Text
      testID={on ? "reading-sentence" : undefined}
      style={level > 0 ? { backgroundColor: alpha(color, level) } : undefined}
    >
      {children}
    </Text>
  );
}

/** Who reads this text: the natural voice when it is downloaded, chosen and has a voice for the language. */
function pickEngine(prefs: ReadAloudPrefs, modelReady: boolean, sample: string) {
  return chooseSpeechEngine({
    preferred: prefs.engine,
    modelReady,
    nativeAvailable: naturalNativeAvailable(),
    language: detectTextLanguage(sample, deviceLocale()),
    voices: prefs.naturalVoices,
  });
}

/** The first stretch of the text is enough to tell its language. */
const SAMPLE_CHARS = 2000;

/**
 * Reads a chapter (or the writer's selection) aloud sentence by sentence,
 * highlighting the sentence being read. The native editor cannot draw
 * highlights, so the chapter is shown here as read-only text.
 */
export function ReadAloud({
  chapterId,
  html,
  selection,
  engine,
  loadVoiceList = loadSystemVoices,
  header,
  chapterTitle,
  manuscriptTitle,
  onOpenVoiceSettings,
}: {
  chapterId: string;
  html: string;
  selection: { start: number; end: number } | null;
  /** Reads with this engine only (tests); otherwise the writer's voice settings pick who reads. */
  engine?: SpeechEngine;
  loadVoiceList?: () => Promise<ReadAloudVoice[]>;
  /** Scrolls away with the page, so the text never slides under a fixed title. */
  header?: ReactNode;
  /** Named on the lock screen while the natural voice reads. */
  chapterTitle?: string;
  manuscriptTitle?: string;
  /** Opens Listening settings; the voice row is only shown when there is somewhere to go. */
  onOpenVoiceSettings?: () => void;
}) {
  const { t } = useTranslation();
  const { layout, colors } = useAppTheme();
  const prefs = useReadAloudPrefs();
  const [state, setState] = useState<ReaderState>("idle");
  const [index, setIndex] = useState(0);
  const [voices, setVoices] = useState<ReadAloudVoice[]>([]);
  const [readingSelection, setReadingSelection] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [fellBack, setFellBack] = useState(false);
  const model = useNaturalModelState();
  const usingNatural = useRef(false);
  const insets = useSafeAreaInsets();
  const readerRef = useRef<SentenceReader | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const lineY = useRef<Map<number, number>>(new Map());
  const lineBreaks = useRef<Map<number, { text: string; y: number }[]>>(new Map());
  const bodyY = useRef(0);
  const viewportHeight = useRef(0);

  const plain = useMemo(() => blocksPlainText(html), [html]);
  const [active, setActive] = useState<ReturnType<typeof readAloudSentences>>([]);
  const shown = active.length > 0 ? active : readAloudSentences(plain, selection);
  const lines = plain.split("\n");

  useEffect(() => {
    const output = engine ? null : getNaturalAudioOutput();
    const system = engine ?? expoSpeechEngine();
    const reader = new SentenceReader(
      system,
      (next, at) => {
        setState(next);
        setIndex(at);
        if (next === "idle") setFellBack(false);
        // The lock-screen card is the natural voice's: the phone's own voices have their own controls.
        const natural = usingNatural.current && !reader.usingFallback;
        if (!output || !natural) return;
        if (next === "idle") output.nowPlaying.hide();
        else output.nowPlaying.show({ title: chapterTitle ?? "", artist: manuscriptTitle }, next);
      },
      {
        fallback: engine ? undefined : () => system,
        onFallback: () => {
          setFellBack(true);
          output?.nowPlaying.hide();
        },
        onBuffering: setBuffering,
      }
    );
    readerRef.current = reader;
    const unsubscribe = output?.nowPlaying.onCommand((command) => {
      if (!usingNatural.current || reader.usingFallback) return;
      if (command === "play") reader.resume();
      else if (command === "pause") reader.pause();
      else reader.stop();
    });
    return () => {
      unsubscribe?.();
      reader.stop();
      output?.nowPlaying.hide();
      readerRef.current = null;
    };
    // The lock-screen title follows the chapter; the reader itself is rebuilt per chapter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, chapterId]);

  useEffect(() => {
    void loadVoiceList().then(setVoices);
  }, [loadVoiceList]);

  // How natural reads went on real phones, and when the phone could not keep up.
  useEffect(
    () =>
      onNaturalEngineEvent((event) => {
        const analytics = getAnalytics();
        if (event.type === "run-finished" && event.firstAudioMs != null && event.rtf != null) {
          analytics.track("natural_voice_read_finished", {
            firstAudioMs: Math.round(event.firstAudioMs),
            rtf: Math.round(event.rtf * 100) / 100,
            underruns: event.underruns,
            synthesized: event.synthesized,
            cached: event.cached,
          });
        } else if (event.type === "gave-up") {
          analytics.track("natural_voice_fallback", { reason: event.reason, why: event.why });
        }
      }),
    []
  );

  useEffect(() => {
    if (fellBack) announce(t("readAloud.fellBack"));
  }, [fellBack, t]);

  const play = useCallback(() => {
    const reader = readerRef.current;
    if (!reader) return;
    if (reader.current.state === "paused") return reader.resume();
    getAnalytics().track("read_aloud_used", {});
    const sentences = readAloudSentences(plain, selection);
    setActive(sentences);
    setReadingSelection(Boolean(selection));
    setFellBack(false);
    const texts = sentences.map((s) => s.text);
    // Read the state fresh: a download may have finished since this screen last rendered.
    const choice = engine
      ? null
      : pickEngine(prefs, naturalModelState().status === "ready", texts.join(" ").slice(0, SAMPLE_CHARS));
    const natural = choice?.kind === "natural" ? getNaturalEngine() : null;
    usingNatural.current = natural !== null;
    reader.start(texts, {
      rate: prefs.rate,
      voice: natural && choice?.kind === "natural" ? choice.voice.id : prefs.voice,
      fallbackVoice: prefs.voice,
      engine: natural ?? undefined,
    });
  }, [plain, selection, engine, prefs]);

  const stop = useCallback(() => {
    readerRef.current?.stop();
    setActive([]);
  }, []);

  const current = state === "idle" ? null : (shown[index] ?? null);
  useEffect(() => {
    if (!current) return;
    const paragraphY = lineY.current.get(current.line);
    if (paragraphY == null) return;
    // Keep the sentence 40% of the way down the viewport, on the line it starts on.
    const inParagraph = lineBreaks.current.get(current.line);
    scrollRef.current?.scrollTo({
      y: readAloudScrollTarget({
        bodyY: bodyY.current,
        paragraphY,
        lineY: inParagraph ? lineYForOffset(inParagraph, current.start) : 0,
        viewportHeight: viewportHeight.current,
      }),
      animated: true,
    });
  }, [current]);

  const sortedVoices = useMemo(() => voiceChoices(voices, deviceLocale(), prefs.voice), [voices, prefs.voice]);
  const choice = pickEngine(prefs, model.status === "ready", plain.slice(0, SAMPLE_CHARS));
  const voiceName =
    choice.kind === "natural"
      ? naturalVoiceName(choice.voice.id)
      : (sortedVoices.find((v) => v.identifier === prefs.voice)?.name ?? t("readAloud.defaultVoice"));
  const nextRate = RATE_STEPS[(RATE_STEPS.findIndex((r) => r === prefs.rate) + 1) % RATE_STEPS.length];

  // The page scrolls; Play, Stop and speed stay in a bar underneath so they are
  // in reach however far into the chapter the reader has got.
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        onLayout={(e) => (viewportHeight.current = e.nativeEvent.layout.height)}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator
      >
        {header}
        <Text style={[layout.cardMeta, { marginBottom: 12 }]}>
          {state === "idle"
            ? selection
              ? t("readAloud.selectionReady")
              : t("readAloud.chapterReady")
            : buffering && state === "playing"
              ? t("readAloud.buffering")
              : t("readAloud.progress", {
                scope: readingSelection ? t("readAloud.selection") : t("readAloud.chapter"),
                current: index + 1,
                total: shown.length,
              })}
        </Text>
        {fellBack ? (
          <Text
            testID="read-aloud-fell-back"
            style={[layout.cardMeta, { marginTop: 0, marginBottom: 12, color: colors.ink }]}
          >
            {t("readAloud.fellBack")}
          </Text>
        ) : null}
        {onOpenVoiceSettings ? (
          <TapPressable
            scale={PRESS_SCALE.card}
            onPress={() => {
              // Listening settings can delete the model the read is using: end the read first.
              stop();
              onOpenVoiceSettings();
            }}
            accessibilityRole="button"
            accessibilityLabel={`${t("readAloud.voice")}: ${voiceName}`}
            style={[styles.voiceRow, { borderColor: colors.line, backgroundColor: colors.bg }]}
          >
            <Text style={[layout.cardMeta, { marginTop: 0 }]}>{t("readAloud.voice")}</Text>
            <Text style={{ color: colors.ink, fontSize: 16, flexShrink: 1 }} numberOfLines={1}>
              {voiceName}  ›
            </Text>
          </TapPressable>
        ) : null}
        <View onLayout={(e) => (bodyY.current = e.nativeEvent.layout.y)}>
        {lines.map((line, lineIndex) => {
          const inLine = shown.filter((s) => s.line === lineIndex);
          const parts: { text: string; on: boolean }[] = [];
          let at = 0;
          for (const s of inLine) {
            if (s.start > at) parts.push({ text: line.slice(at, s.start), on: false });
            parts.push({ text: line.slice(s.start, s.end), on: current === s });
            at = s.end;
          }
          if (at < line.length) parts.push({ text: line.slice(at), on: false });
          return (
            <Text
              key={lineIndex}
              onLayout={(e) => lineY.current.set(lineIndex, e.nativeEvent.layout.y)}
              onTextLayout={(e) =>
                lineBreaks.current.set(
                  lineIndex,
                  e.nativeEvent.lines.map((l) => ({ text: l.text, y: l.y }))
                )
              }
              style={{
                fontFamily: fonts.serif,
                fontSize: 18,
                lineHeight: 30,
                color: colors.ink,
                marginBottom: 12,
              }}
            >
              {parts.map((p, i) => (
                <Sentence key={i} on={p.on} color={colors.accentSoft}>
                  {p.text}
                </Sentence>
              ))}
            </Text>
          );
        })}
      </View>
      </ScrollView>
      <View
        style={[
          styles.bar,
          { borderTopColor: colors.line, backgroundColor: colors.bg, paddingBottom: Math.max(insets.bottom, 12) },
        ]}
      >
        {state === "playing" ? (
          <TapPressable
            onPress={() => readerRef.current?.pause()}
            accessibilityRole="button"
            accessibilityLabel={t("readAloud.pause")}
            style={[styles.button, { backgroundColor: colors.accent }]}
          >
            <Text style={styles.buttonText}>{t("readAloud.pause")}</Text>
          </TapPressable>
        ) : (
          <TapPressable
            onPress={play}
            disabled={shown.length === 0}
            accessibilityRole="button"
            accessibilityLabel={state === "paused" ? t("readAloud.resume") : t("readAloud.play")}
            style={[styles.button, { backgroundColor: colors.accent, opacity: shown.length === 0 ? 0.5 : 1 }]}
          >
            <Text style={styles.buttonText}>
              {state === "paused" ? t("readAloud.resume") : t("readAloud.play")}
            </Text>
          </TapPressable>
        )}
        <TapPressable
          onPress={stop}
          disabled={state === "idle"}
          accessibilityRole="button"
          accessibilityLabel={t("readAloud.stop")}
          style={[styles.button, { borderWidth: 1, borderColor: colors.line, opacity: state === "idle" ? 0.5 : 1 }]}
        >
          <Text style={[styles.buttonText, { color: colors.ink }]}>{t("readAloud.stop")}</Text>
        </TapPressable>
        <TapPressable
          scale={PRESS_SCALE.chip}
          onPress={() => {
            setReadAloudPrefs({ rate: nextRate });
            readerRef.current?.setRate(nextRate);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${t("readAloud.speed")}: ${prefs.rate}x`}
          style={[styles.speed, { borderColor: colors.line, backgroundColor: colors.accentSoft }]}
        >
          <Text style={{ color: colors.accent, fontSize: 16, fontWeight: "600" }}>{prefs.rate}x</Text>
        </TapPressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  speed: {
    minWidth: 64,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceRow: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
});
