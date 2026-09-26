import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../lib/settings";
import { fonts } from "../lib/theme";
import { blocksPlainText } from "../lib/read-aloud-text";
import {
  expoSpeechEngine,
  RATE_STEPS,
  readAloudSentences,
  SentenceReader,
  setReadAloudPrefs,
  useReadAloudPrefs,
  type ReaderState,
  type SpeechEngine,
} from "../lib/read-aloud";

export type ReadAloudVoice = { identifier: string; name: string; language: string };

async function loadVoices(): Promise<ReadAloudVoice[]> {
  try {
    const Speech = require("expo-speech") as typeof import("expo-speech");
    const all = await Speech.getAvailableVoicesAsync();
    return all.map((v) => ({ identifier: v.identifier, name: v.name, language: v.language }));
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
}: {
  chapterId: string;
  html: string;
  selection: { start: number; end: number } | null;
  engine?: SpeechEngine;
  loadVoiceList?: () => Promise<ReadAloudVoice[]>;
}) {
  const { t } = useTranslation();
  const { layout, colors } = useAppTheme();
  const prefs = useReadAloudPrefs();
  const [state, setState] = useState<ReaderState>("idle");
  const [index, setIndex] = useState(0);
  const [voices, setVoices] = useState<ReadAloudVoice[]>([]);
  const [readingSelection, setReadingSelection] = useState(false);
  const readerRef = useRef<SentenceReader | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const lineY = useRef<Map<number, number>>(new Map());

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
    const y = lineY.current.get(current.line);
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
  }, [current]);

  const sortedVoices = useMemo(() => voices.slice(0, 40), [voices]);

  const chip = (label: string, selected: boolean, onPress: () => void, key: string) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[
        styles.chip,
        {
          borderColor: selected ? colors.accent : colors.line,
          backgroundColor: selected ? colors.accentSoft : colors.bg,
        },
      ]}
    >
      <Text style={{ color: selected ? colors.accent : colors.ink, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={[layout.card, { marginBottom: 12 }]}>
        <Text style={layout.cardMeta}>
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
        <View style={styles.row}>
          {state === "playing" ? (
            <Pressable
              onPress={() => readerRef.current?.pause()}
              accessibilityRole="button"
              accessibilityLabel={t("readAloud.pause")}
              style={[styles.button, { backgroundColor: colors.accent }]}
            >
              <Text style={styles.buttonText}>{t("readAloud.pause")}</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={play}
              disabled={shown.length === 0}
              accessibilityRole="button"
              accessibilityLabel={state === "paused" ? t("readAloud.resume") : t("readAloud.play")}
              style={[styles.button, { backgroundColor: colors.accent, opacity: shown.length === 0 ? 0.5 : 1 }]}
            >
              <Text style={styles.buttonText}>
                {state === "paused" ? t("readAloud.resume") : t("readAloud.play")}
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={stop}
            disabled={state === "idle"}
            accessibilityRole="button"
            accessibilityLabel={t("readAloud.stop")}
            style={[styles.button, { borderWidth: 1, borderColor: colors.line, opacity: state === "idle" ? 0.5 : 1 }]}
          >
            <Text style={[styles.buttonText, { color: colors.ink }]}>{t("readAloud.stop")}</Text>
          </Pressable>
        </View>
        <Text style={[layout.cardMeta, { marginTop: 12 }]}>{t("readAloud.speed")}</Text>
        <View style={styles.chips}>
          {RATE_STEPS.map((rate) =>
            chip(
              `${rate}x`,
              prefs.rate === rate,
              () => {
                setReadAloudPrefs({ rate });
                readerRef.current?.setRate(rate);
              },
              `rate-${rate}`
            )
          )}
        </View>
        {sortedVoices.length > 0 ? (
          <>
            <Text style={[layout.cardMeta, { marginTop: 12 }]}>{t("readAloud.voice")}</Text>
            <View style={styles.chips}>
              {chip(
                t("readAloud.defaultVoice"),
                prefs.voice === null,
                () => {
                  setReadAloudPrefs({ voice: null });
                  readerRef.current?.setVoice(null);
                },
                "voice-default"
              )}
              {sortedVoices.map((voice) =>
                chip(
                  `${voice.name} (${voice.language})`,
                  prefs.voice === voice.identifier,
                  () => {
                    setReadAloudPrefs({ voice: voice.identifier });
                    readerRef.current?.setVoice(voice.identifier);
                  },
                  voice.identifier
                )
              )}
            </View>
          </>
        ) : null}
      </View>
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }}>
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
              style={{
                fontFamily: fonts.serif,
                fontSize: 18,
                lineHeight: 30,
                color: colors.ink,
                marginBottom: 12,
              }}
            >
              {parts.map((p, i) => (
                <Text
                  key={i}
                  testID={p.on ? "reading-sentence" : undefined}
                  style={p.on ? { backgroundColor: colors.accentSoft } : undefined}
                >
                  {p.text}
                </Text>
              ))}
            </Text>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, marginTop: 12 },
  button: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
});
