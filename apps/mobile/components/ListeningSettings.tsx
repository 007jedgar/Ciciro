import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSharedValue, withTiming } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { DrawCheck, useDrawProgress } from "./DrawCheck";
import { AlertText } from "./AlertText";
import { announce } from "../lib/announce";
import { GlassSheet } from "./GlassSheet";
import { CheckIcon, PlayIcon, StopIcon, TrashIcon } from "./icons";
import { ProgressRing } from "./ProgressRing";
import { SelectCheck, SelectChip, SelectLabel } from "./SelectChip";
import { Group, Hairline, InfoRow, SectionHeader, SheetRow } from "./SettingsParts";
import { TapPressable } from "./TapPressable";
import { getAnalytics } from "../lib/analytics-client";
import * as haptics from "../lib/haptics";
import { EASE_OUT, PRESS_SCALE } from "../lib/motion";
import {
  clearNaturalAudioCache,
  naturalAudioCacheBytes,
  naturalNativeAvailable,
} from "../lib/natural-engine";
import { packInstallBytes, type ModelError, type ModelState } from "../lib/natural-model";
import { refreshNaturalModel, useNaturalModelState } from "../lib/natural-model-store";
import { getNaturalAudioOutput } from "../lib/natural-audio-output";
import { formatMegabytes, KOKORO_PACK, NATURAL_MODEL_DOWNLOAD_BYTES } from "../lib/natural-pack";
import {
  cancelNaturalDownload,
  deleteNaturalVoice,
  downloadNaturalVoice,
  pauseNaturalDownload,
} from "../lib/natural-voice-actions";
import { sampleFor } from "../lib/natural-voice-samples";
import {
  DEFAULT_NATURAL_VOICE,
  NATURAL_LANGUAGES,
  naturalVoiceName,
  naturalVoicesFor,
  type NaturalLanguage,
  type NaturalVoice,
} from "../lib/natural-voice";
import { setReadAloudPrefs, useReadAloudPrefs, voiceChoices, type VoiceOption } from "../lib/read-aloud";
import { useAppTheme } from "../lib/settings";
import { loadSystemVoices, deviceLocale } from "../lib/system-voices";
import { useReduceMotion } from "../lib/use-reduce-motion";
import type { ColorTokens } from "../lib/theme";

const RING = 56;

/** The ring fills to the download's progress over this long, then holds. */
const FILL_MS = 400;

function fraction(state: ModelState): number {
  switch (state.status) {
    case "downloading":
    case "paused":
    case "error":
      return state.total > 0 ? Math.min(1, state.bytes / state.total) : 0;
    // The download is complete: the ring stays full while the files are unpacked, then closes on a tick.
    case "installing":
    case "ready":
      return 1;
    default:
      return 0;
  }
}

/** The natural voice's download as a ring that fills and closes on a tick: it has an end the writer can reach. */
function DownloadRing({ state, colors }: { state: ModelState; colors: ColorTokens }) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const progress = fraction(state);
  const ring = useSharedValue(reduceMotion ? progress : 0);
  useEffect(() => {
    ring.value = reduceMotion ? progress : withTiming(progress, { duration: FILL_MS, easing: EASE_OUT });
  }, [progress, reduceMotion, ring]);
  const ready = state.status === "ready";
  const tick = useDrawProgress(ready, FILL_MS);
  const percent = Math.floor(progress * 100);
  return (
    <ProgressRing progress={ring} size={RING} strokeWidth={5} color={colors.accent} trackColor={colors.line}>
      {ready ? (
        <DrawCheck progress={tick} color={colors.accent} size={Math.round(RING * 0.44)} strokeWidth={2.2} />
      ) : state.status === "installing" ? null : (
        <Text
          accessibilityLabel={t("listening.percentA11y", { percent })}
          style={{ color: colors.ink, fontSize: 14, fontVariant: ["tabular-nums"] }}
        >
          {`${percent}%`}
        </Text>
      )}
    </ProgressRing>
  );
}

function errorText(error: ModelError, t: (key: string, options?: Record<string, unknown>) => string): string {
  switch (error.reason) {
    case "network":
      return t("listening.errorNetwork");
    case "storage":
      return t("listening.errorStorage", {
        size: formatMegabytes(error.neededBytes ?? packInstallBytes(KOKORO_PACK)),
      });
    case "integrity":
      return t("listening.errorIntegrity");
    case "install":
      return t("listening.errorInstall");
    default:
      return t("listening.errorUnknown");
  }
}

function PillButton({
  label,
  onPress,
  colors,
  kind = "primary",
  testID,
}: {
  label: string;
  onPress: () => void;
  colors: ColorTokens;
  kind?: "primary" | "quiet";
  testID?: string;
}) {
  const primary = kind === "primary";
  return (
    <TapPressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flex: 1,
        minHeight: 48,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 14,
        backgroundColor: primary ? colors.accent : "transparent",
        borderWidth: primary ? 0 : 1,
        borderColor: colors.line,
      }}
    >
      <Text style={{ fontSize: 16, fontWeight: "600", color: primary ? colors.panel : colors.ink }}>{label}</Text>
    </TapPressable>
  );
}

/** One of the two ways to be read to: a card with its name and what it is good for. */
function EngineCard({
  title,
  hint,
  selected,
  disabled,
  onPress,
  colors,
  testID,
}: {
  title: string;
  hint: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  colors: ColorTokens;
  testID?: string;
}) {
  return (
    <SelectChip
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      selected={selected}
      tokens={{
        restFill: "transparent",
        activeFill: colors.accentSoft,
        restBorder: colors.line,
        activeBorder: colors.accent,
        restText: colors.ink,
        activeText: colors.ink,
      }}
      scale={PRESS_SCALE.card}
      accessibilityRole="radio"
      accessibilityLabel={`${title}. ${hint}`}
      accessibilityState={{ selected, disabled: Boolean(disabled) }}
      style={{ marginBottom: 8, opacity: disabled ? 0.55 : 1 }}
      surfaceStyle={{
        borderRadius: 14,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <SelectLabel style={{ fontSize: 17 }}>{title}</SelectLabel>
        <Text style={{ marginTop: 2, fontSize: 14, lineHeight: 20, color: colors.inkSoft }}>{hint}</Text>
      </View>
      <SelectCheck>
        <CheckIcon color={colors.accent} size={18} />
      </SelectCheck>
    </SelectChip>
  );
}

/** A natural voice: pick it for its language, and hear a short sample of it before (or after) downloading. */
function VoiceRow({
  voice,
  selected,
  playing,
  canPlay,
  colors,
  onSelect,
  onToggleSample,
}: {
  voice: NaturalVoice;
  selected: boolean;
  playing: boolean;
  canPlay: boolean;
  colors: ColorTokens;
  onSelect: () => void;
  onToggleSample: () => void;
}) {
  const { t } = useTranslation();
  const name = naturalVoiceName(voice.id);
  const detail = [
    voice.accent === "us" ? t("listening.accentUs") : voice.accent === "gb" ? t("listening.accentGb") : null,
    voice.gender === "female" ? t("listening.female") : t("listening.male"),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 4, paddingLeft: 4, paddingRight: 8 }}>
      <SelectChip
        onPress={onSelect}
        testID={`voice-${voice.id}`}
        selected={selected}
        tokens={{
          restFill: "transparent",
          activeFill: colors.accentSoft,
          restBorder: "transparent",
          activeBorder: "transparent",
          restText: colors.ink,
          activeText: colors.ink,
        }}
        scale={PRESS_SCALE.card}
        accessibilityRole="radio"
        accessibilityLabel={`${name}, ${detail}`}
        accessibilityState={{ selected }}
        style={{ flex: 1 }}
        surfaceStyle={{
          minHeight: 52,
          borderRadius: 12,
          paddingHorizontal: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <View style={{ flex: 1 }}>
          <SelectLabel style={{ fontSize: 17 }}>{name}</SelectLabel>
          <Text style={{ marginTop: 1, fontSize: 13, color: colors.inkSoft }}>{detail}</Text>
        </View>
        <SelectCheck>
          <CheckIcon color={colors.accent} size={18} />
        </SelectCheck>
      </SelectChip>
      {canPlay ? (
        <TapPressable
          onPress={onToggleSample}
          testID={`sample-${voice.id}`}
          accessibilityRole="button"
          accessibilityLabel={playing ? t("listening.stopSample", { name }) : t("listening.playSample", { name })}
          hitSlop={4}
          // No fill of its own: the press engine tints a pressable from its style at render time, and a
          // fill that comes and goes with `playing` left the last tint behind. The state is drawn inside.
          style={{ marginLeft: 8, width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
        >
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius: 22,
                borderWidth: 1,
                borderColor: playing ? colors.accent : colors.line,
                backgroundColor: playing ? colors.accentSoft : "transparent",
              },
            ]}
          />
          {playing ? <StopIcon color={colors.accent} size={14} /> : <PlayIcon color={colors.accent} size={14} />}
        </TapPressable>
      ) : null}
    </View>
  );
}

/**
 * The Listening settings: system voice or the natural voice, the opt-in
 * download with its progress, a sample of each natural voice, and the audio
 * kept on the phone. Nothing here sends anything anywhere except the model
 * download itself, from the source named in `KOKORO_PACK`.
 */
export function ListeningSettings() {
  const { t } = useTranslation();
  const { colors, layout } = useAppTheme();
  const prefs = useReadAloudPrefs();
  const model = useNaturalModelState();
  const available = naturalNativeAvailable();
  const output = useMemo(() => getNaturalAudioOutput(), []);
  const [systemVoices, setSystemVoices] = useState<VoiceOption[]>([]);
  const [systemOpen, setSystemOpen] = useState(false);
  const [cacheBytes, setCacheBytes] = useState(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const clip = useRef<{ id: string; stop(): void } | null>(null);
  const previous = useRef(model.status);

  const ready = model.status === "ready";
  const engine = ready && (prefs.engine ?? "natural") === "natural" ? "natural" : "system";

  useEffect(() => {
    refreshNaturalModel();
    void loadSystemVoices().then(setSystemVoices);
  }, []);

  useEffect(() => {
    void naturalAudioCacheBytes().then(setCacheBytes);
  }, [model.status]);

  // The download finishing is worth a moment of its own: the ring closes on a tick and the phone agrees.
  useEffect(() => {
    if (previous.current !== "ready" && model.status === "ready" && (previous.current === "installing" || previous.current === "downloading")) {
      haptics.success();
      announce(t("listening.ready", { size: formatMegabytes(model.status === "ready" ? model.bytes : 0) }));
    }
    previous.current = model.status;
  }, [model, t]);

  const stopSample = useCallback(() => {
    clip.current?.stop();
    clip.current = null;
    setPlaying(null);
  }, []);
  useEffect(() => stopSample, [stopSample]);

  const toggleSample = (voice: NaturalVoice) => {
    if (clip.current?.id === voice.id) return stopSample();
    stopSample();
    const source = sampleFor(voice.id);
    if (!output || source == null) return;
    getAnalytics().track("natural_voice_sample_played", { voice: voice.id });
    const started = output.playClip(source);
    const mine = { id: voice.id, stop: started.stop };
    clip.current = mine;
    setPlaying(voice.id);
    void started.done.then(() => {
      if (clip.current === mine) {
        clip.current = null;
        setPlaying(null);
      }
    });
  };

  const chooseEngine = (next: "system" | "natural") => {
    setReadAloudPrefs({ engine: next });
    getAnalytics().track("listening_engine_chosen", { engine: next });
  };

  const chooseVoice = (language: NaturalLanguage, voice: NaturalVoice) => {
    setReadAloudPrefs({ naturalVoices: { ...prefs.naturalVoices, [language]: voice.id } });
    getAnalytics().track("natural_voice_chosen", { voice: voice.id });
  };

  const startDownload = async (allowMetered: boolean) => {
    const result = await downloadNaturalVoice({ allowMetered });
    if (result !== "needs-confirmation") return;
    Alert.alert(
      t("listening.mobileDataTitle"),
      t("listening.mobileDataBody", { size: formatMegabytes(NATURAL_MODEL_DOWNLOAD_BYTES) }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("listening.mobileDataConfirm"), onPress: () => void startDownload(true) },
      ]
    );
  };

  const confirmDelete = () => {
    Alert.alert(t("listening.deleteTitle"), t("listening.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => {
          stopSample();
          void deleteNaturalVoice().then(() => naturalAudioCacheBytes().then(setCacheBytes));
        },
      },
    ]);
  };

  const clearSaved = () => {
    void clearNaturalAudioCache().then(() => setCacheBytes(0));
  };

  const sortedSystemVoices = useMemo(
    () => voiceChoices(systemVoices, deviceLocale(), prefs.voice),
    [systemVoices, prefs.voice]
  );
  const systemVoiceName =
    sortedSystemVoices.find((v) => v.identifier === prefs.voice)?.name ?? t("listening.systemVoiceDefault");
  const pickSystemVoice = (identifier: string | null) => {
    setReadAloudPrefs({ voice: identifier });
    setSystemOpen(false);
  };

  const downloadSize = formatMegabytes(NATURAL_MODEL_DOWNLOAD_BYTES);
  const busy = model.status === "downloading" || model.status === "paused" || model.status === "installing";

  return (
    <View>
      <Text style={[layout.body, { marginBottom: 16 }]}>{t("listening.blurb")}</Text>

      <SectionHeader label={t("listening.engineHeader")} colors={colors} />
      <View accessibilityRole="radiogroup" style={{ marginBottom: 8 }}>
        <EngineCard
          testID="engine-system"
          title={t("listening.systemTitle")}
          hint={t("listening.systemHint")}
          selected={engine === "system"}
          onPress={() => chooseEngine("system")}
          colors={colors}
        />
        <EngineCard
          testID="engine-natural"
          title={t("listening.naturalTitle")}
          hint={t("listening.naturalHint")}
          selected={engine === "natural"}
          disabled={!ready}
          onPress={() => chooseEngine("natural")}
          colors={colors}
        />
      </View>

      {available ? (
        <Group colors={colors}>
          {model.status === "absent" || model.status === "error" ? (
            <View style={{ padding: 16, gap: 12 }}>
              {model.status === "error" ? <AlertText style={{ fontSize: 15, lineHeight: 21, color: colors.danger }}>{errorText(model.error, t)}</AlertText> : null}
              <Text style={{ fontSize: 15, lineHeight: 21, color: colors.ink }}>
                {t("listening.downloadSize", { size: downloadSize })}
              </Text>
              <Text style={{ fontSize: 14, lineHeight: 20, color: colors.inkSoft }}>{t("listening.wifiTip")}</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <PillButton
                  testID="download-natural"
                  label={model.status === "error" ? t("listening.tryAgain") : t("listening.download")}
                  onPress={() => void startDownload(false)}
                  colors={colors}
                />
              </View>
            </View>
          ) : null}

          {busy || ready ? (
            <>
              {/* One ring for the whole of it, so it fills, stays full while unpacking and closes on the tick. */}
              <View style={{ padding: 16, flexDirection: "row", alignItems: "center", gap: 16 }}>
                <DownloadRing state={model} colors={colors} />
                <View style={{ flex: 1 }}>
                  <Text
                    testID="natural-status"
                    style={{ fontSize: 17, lineHeight: 23, color: colors.ink, fontVariant: ["tabular-nums"] }}
                  >
                    {model.status === "downloading"
                      ? t("listening.downloading", { percent: Math.floor(fraction(model) * 100) })
                      : model.status === "paused"
                        ? t("listening.paused", { percent: Math.floor(fraction(model) * 100) })
                        : model.status === "installing"
                          ? t("listening.installing")
                          : t("listening.ready", { size: formatMegabytes(model.bytes) })}
                  </Text>
                  {model.status === "downloading" || model.status === "paused" ? (
                    <Text style={{ marginTop: 2, fontSize: 14, color: colors.inkSoft, fontVariant: ["tabular-nums"] }}>
                      {t("listening.downloadProgress", { done: formatMegabytes(model.bytes), total: formatMegabytes(model.total) })}
                    </Text>
                  ) : null}
                </View>
              </View>
              {model.status === "downloading" || model.status === "paused" ? (
                <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {model.status === "downloading" ? (
                      <PillButton key="pause" testID="pause-download" label={t("listening.pause")} onPress={pauseNaturalDownload} colors={colors} kind="quiet" />
                    ) : (
                      <PillButton key="resume" testID="resume-download" label={t("listening.resume")} onPress={() => void startDownload(false)} colors={colors} />
                    )}
                    <PillButton key="cancel" testID="cancel-download" label={t("listening.cancel")} onPress={() => void cancelNaturalDownload()} colors={colors} kind="quiet" />
                  </View>
                  <Text style={{ fontSize: 14, lineHeight: 20, color: colors.inkSoft }}>{t("listening.wifiTip")}</Text>
                </View>
              ) : null}
              {ready ? (
                <>
                  <Hairline colors={colors} />
                  <TapPressable
                    onPress={confirmDelete}
                    testID="delete-natural"
                    accessibilityRole="button"
                    accessibilityLabel={t("listening.deleteRow", { size: formatMegabytes(model.bytes) })}
                    style={{ minHeight: 52, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "transparent" }}
                    highlight
                    feedback="none"
                  >
                    <TrashIcon color={colors.danger} size={18} />
                    <Text style={{ fontSize: 17, color: colors.danger }}>{t("listening.deleteRow", { size: formatMegabytes(model.bytes) })}</Text>
                  </TapPressable>
                </>
              ) : null}
            </>
          ) : null}
        </Group>
      ) : (
        <Text style={{ marginBottom: 16, fontSize: 14, lineHeight: 20, color: colors.inkSoft }}>
          {t("listening.naturalUnavailable")}
        </Text>
      )}

      <SectionHeader label={t("listening.voicesHeader")} colors={colors} />
      <Text style={{ marginHorizontal: 16, marginBottom: 12, fontSize: 14, lineHeight: 20, color: colors.inkSoft }}>
        {t("listening.voicesHint")}
      </Text>
      {NATURAL_LANGUAGES.map((language) => {
        const chosen = prefs.naturalVoices[language] ?? DEFAULT_NATURAL_VOICE[language];
        return (
          <View key={language}>
            <Text style={{ marginHorizontal: 16, marginBottom: 6, fontSize: 13, fontWeight: "600", color: colors.inkSoft }}>
              {t(language === "en" ? "listening.languageEn" : language === "es" ? "listening.languageEs" : "listening.languageHi")}
            </Text>
            <Group colors={colors}>
              {naturalVoicesFor(language).map((voice) => (
                <VoiceRow
                  key={voice.id}
                  voice={voice}
                  selected={chosen === voice.id}
                  playing={playing === voice.id}
                  canPlay={Boolean(output) && sampleFor(voice.id) != null}
                  colors={colors}
                  onSelect={() => chooseVoice(language, voice)}
                  onToggleSample={() => toggleSample(voice)}
                />
              ))}
            </Group>
          </View>
        );
      })}
      <Text style={{ marginHorizontal: 16, marginBottom: 20, fontSize: 14, lineHeight: 20, color: colors.inkSoft }}>
        {t("listening.otherLanguages")}
      </Text>

      <SectionHeader label={t("listening.systemVoiceHeader")} colors={colors} />
      <Group colors={colors}>
        <SheetRow
          label={t("readAloud.voice")}
          value={systemVoiceName}
          onPress={() => setSystemOpen(true)}
          colors={colors}
          last
        />
      </Group>
      {Platform.OS === "ios" ? (
        <Text style={{ marginHorizontal: 16, marginTop: -8, marginBottom: 20, fontSize: 14, lineHeight: 20, color: colors.inkSoft }}>
          {t("listening.systemVoiceHintIos")}
        </Text>
      ) : null}

      {available && (ready || cacheBytes > 0) ? (
        <>
          <SectionHeader label={t("listening.audioHeader")} colors={colors} />
          <Group colors={colors}>
            <InfoRow label={t("listening.audioRow")} value={formatMegabytes(cacheBytes)} colors={colors} />
            <Hairline colors={colors} />
            <TapPressable
              onPress={clearSaved}
              disabled={cacheBytes === 0}
              testID="clear-saved-audio"
              accessibilityRole="button"
              accessibilityLabel={t("listening.audioClear")}
              style={{ minHeight: 52, paddingHorizontal: 16, justifyContent: "center", backgroundColor: "transparent", opacity: cacheBytes === 0 ? 0.5 : 1 }}
              highlight
              feedback="none"
            >
              <Text style={{ fontSize: 17, color: colors.ink }}>{t("listening.audioClear")}</Text>
            </TapPressable>
          </Group>
          <Text style={{ marginHorizontal: 16, marginTop: -8, marginBottom: 20, fontSize: 14, lineHeight: 20, color: colors.inkSoft }}>
            {t("listening.audioHint")}
          </Text>
        </>
      ) : null}

      {available ? (
        <Text style={{ marginHorizontal: 16, fontSize: 14, lineHeight: 20, color: colors.inkSoft }}>{t("listening.lockScreen")}</Text>
      ) : null}

      <GlassSheet
        visible={systemOpen}
        onClose={() => setSystemOpen(false)}
        title={t("listening.systemVoiceHeader")}
        snapPoints={[0.62]}
        testID="voice-sheet"
      >
        <ScrollView>
          {[{ identifier: null as string | null, label: t("listening.systemVoiceDefault") }]
            .concat(sortedSystemVoices.map((v) => ({ identifier: v.identifier, label: `${v.name} (${v.language})` })))
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
                  onPress={() => pickSystemVoice(opt.identifier)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={opt.label}
                  surfaceStyle={{ minHeight: 48, borderRadius: 14, paddingHorizontal: 14, justifyContent: "center" }}
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
