import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { getLocales } from "expo-localization";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "../lib/settings";
import { useFade } from "../lib/use-fade";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { alpha } from "./Glass";
import { GlassSheet } from "./GlassSheet";
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
  type SpeechEngine,
  type VoiceOption,
} from "../lib/read-aloud";
import { getAnalytics } from "../lib/analytics-client";
import { SelectChip, SelectLabel } from "./SelectChip";
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

function deviceLocale(): string {
  try {
    return getLocales()[0]?.languageTag ?? "";
  } catch {
    return "";
  }
}

async function loadVoices(): Promise<ReadAloudVoice[]> {
  try {
    const Speech = require("expo-speech") as typeof import("expo-speech");
    const all = await Speech.getAvailableVoicesAsync();
    return all.map((v) => ({
      identifier: v.identifier,
      name: v.name,
      language: v.language,
      quality: String(v.quality),
    }));
  } catch {
    return [];
  }
}

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
  loadVoiceList = loadVoices,
  header,
}: {
  chapterId: string;
  html: string;
  selection: { start: number; end: number } | null;
  engine?: SpeechEngine;
  loadVoiceList?: () => Promise<ReadAloudVoice[]>;
  /** Scrolls away with the page, so the text never slides under a fixed title. */
  header?: ReactNode;
}) {
  const { t } = useTranslation();
  const { layout, colors } = useAppTheme();
  const prefs = useReadAloudPrefs();
  const [state, setState] = useState<ReaderState>("idle");
  const [index, setIndex] = useState(0);
  const [voices, setVoices] = useState<ReadAloudVoice[]>([]);
  const [readingSelection, setReadingSelection] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
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
    const reader = new SentenceReader(engine ?? expoSpeechEngine(), (next, at) => {
      setState(next);
      setIndex(at);
    });
    readerRef.current = reader;
    return () => {
      reader.stop();
      readerRef.current = null;
    };
  }, [engine, chapterId]);

  useEffect(() => {
    void loadVoiceList().then(setVoices);
  }, [loadVoiceList]);

  const play = useCallback(() => {
    const reader = readerRef.current;
    if (!reader) return;
    if (reader.current.state === "paused") return reader.resume();
    getAnalytics().track("read_aloud_used", {});
    const sentences = readAloudSentences(plain, selection);
    setActive(sentences);
    setReadingSelection(Boolean(selection));
    reader.start(
      sentences.map((s) => s.text),
      { rate: prefs.rate, voice: prefs.voice }
    );
  }, [plain, selection, prefs.rate, prefs.voice]);

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

  const voiceName =
    sortedVoices.find((v) => v.identifier === prefs.voice)?.name ?? t("readAloud.defaultVoice");
  const nextRate = RATE_STEPS[(RATE_STEPS.findIndex((r) => r === prefs.rate) + 1) % RATE_STEPS.length];
  const pickVoice = (identifier: string | null) => {
    setReadAloudPrefs({ voice: identifier });
    readerRef.current?.setVoice(identifier);
    setVoiceOpen(false);
  };

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
            : t("readAloud.progress", {
                scope: readingSelection ? t("readAloud.selection") : t("readAloud.chapter"),
                current: index + 1,
                total: shown.length,
              })}
        </Text>
        {sortedVoices.length > 0 ? (
          <TapPressable
            scale={PRESS_SCALE.card}
            onPress={() => setVoiceOpen(true)}
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
      <GlassSheet
        visible={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        title={t("readAloud.voice")}
        snapPoints={[0.62]}
        testID="voice-sheet"
      >
        <ScrollView>
          {[{ identifier: null as string | null, label: t("readAloud.defaultVoice") }]
            .concat(sortedVoices.map((v) => ({ identifier: v.identifier, label: `${v.name} (${v.language})` })))
            .map((opt) => {
              const selected = prefs.voice === opt.identifier;
              return (
                <SelectChip
                  key={opt.identifier ?? "default"}
                  selected={selected}
                  tokens={{
                    restFill: "transparent",
                    activeFill: colors.accentSoft,
                    restBorder: "transparent",
                    activeBorder: "transparent",
                    restText: colors.ink,
                    activeText: colors.accent,
                  }}
                  scale={PRESS_SCALE.card}
                  onPress={() => pickVoice(opt.identifier)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={opt.label}
                  surfaceStyle={styles.option}
                >
                  <SelectLabel style={{ fontSize: 16 }}>{opt.label}</SelectLabel>
                </SelectChip>
              );
            })}
        </ScrollView>
      </GlassSheet>
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
  option: { minHeight: 48, borderRadius: 14, paddingHorizontal: 14, justifyContent: "center" },
});
