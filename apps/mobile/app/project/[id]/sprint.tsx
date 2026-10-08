import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { Easing, useSharedValue, withTiming } from "react-native-reanimated";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppHeader, useMeasuredAppHeaderHeight } from "../../../components/AppHeader";
import { useSession } from "../../../lib/session";
import { useAppTheme } from "../../../lib/settings";
import * as haptics from "../../../lib/haptics";
import { useReduceMotion } from "../../../lib/use-reduce-motion";
import { useStackBack } from "../../../lib/use-stack-back";
import { closeSprintSitting, useWritingDay } from "../../../lib/writing-day-session";
import {
  formatSprintClock,
  getActiveSprint,
  setActiveSprint,
  SPRINT_DURATIONS_MIN,
  SPRINT_END_NOTIFICATION_ID,
  sprintEndsAt,
  sprintRemainingMs,
  sprintWordsWritten,
  subscribeActiveSprint,
  type ActiveSprint,
  type SprintDurationMin,
} from "../../../lib/writing-sprint";
import { getAnalytics } from "../../../lib/analytics-client";
import { DrawCheck, useDrawProgress } from "../../../components/DrawCheck";
import { ProgressRing } from "../../../components/ProgressRing";
import { RollingNumber } from "../../../components/RollingNumber";
import { TapPressable } from "../../../components/TapPressable";

async function scheduleSprintEndNotification(endsAt: number, title: string, body: string): Promise<void> {
  try {
    const Notifications = await import("expo-notifications");
    await Notifications.cancelScheduledNotificationAsync(SPRINT_END_NOTIFICATION_ID);
    const seconds = Math.max(1, Math.round((endsAt - Date.now()) / 1000));
    await Notifications.scheduleNotificationAsync({
      identifier: SPRINT_END_NOTIFICATION_ID,
      content: { title, body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
      },
    });
  } catch {
    /* web / permission */
  }
}

async function cancelSprintEndNotification(): Promise<void> {
  try {
    const Notifications = await import("expo-notifications");
    await Notifications.cancelScheduledNotificationAsync(SPRINT_END_NOTIFICATION_ID);
  } catch {
    /* ignore */
  }
}

type Phase =
  | { kind: "pick" }
  | { kind: "running"; sprint: ActiveSprint }
  | {
      kind: "done";
      durationMin: SprintDurationMin;
      words: number;
      /** The clock ran out, so the ring closes and the sprint is celebrated; ending early leaves it as far as it got. */
      completed: boolean;
      /** How much of the sprint had run, 0 to 1. */
      fraction: number;
    };

/** The sprint ring's size around the running clock, and the smaller one that holds the finished word count. */
const CLOCK_RING = 248;
const DONE_RING = 168;
/** The ring closes over this long, then the count rolls up and the tick draws. */
const RING_CLOSE_MS = 420;

export default function SprintScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { user, ready } = useSession();
  const { layout, colors } = useAppTheme();
  const [headerHeight, onHeaderHeight] = useMeasuredAppHeaderHeight();
  const { id } = useLocalSearchParams<{ id: string }>();
  const day = useWritingDay();
  const active = useSyncExternalStore(subscribeActiveSprint, getActiveSprint, getActiveSprint);
  const [now, setNow] = useState(Date.now());
  const [phase, setPhase] = useState<Phase>(() => {
    const existing = getActiveSprint();
    return existing ? { kind: "running", sprint: existing } : { kind: "pick" };
  });
  const finishingRef = useRef(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reduceMotion = useReduceMotion();
  const ringProgress = useSharedValue(0);
  const [shownWords, setShownWords] = useState(0);

  const finish = useCallback(
    (sprint: ActiveSprint, completed: boolean) => {
      if (finishingRef.current) return;
      if (!getActiveSprint()) return;
      finishingRef.current = true;
      void cancelSprintEndNotification();
      const words = sprintWordsWritten(sprint.startWords, day.words);
      closeSprintSitting(sprint.projectId, sprint.startedAt, words);
      getAnalytics().track("writing_sprint_completed", { durationMinutes: sprint.durationMin });
      setActiveSprint(null);
      const fraction = completed
        ? 1
        : Math.min(1, Math.max(0, (Date.now() - sprint.startedAt) / (sprint.durationMin * 60_000)));
      if (completed) haptics.celebrate();
      setPhase({ kind: "done", durationMin: sprint.durationMin, words, completed, fraction });
      finishingRef.current = false;
    },
    [day.words]
  );

  useEffect(() => {
    if (!id || Array.isArray(id)) return;
    if (active && active.projectId === id) {
      if (sprintRemainingMs(active.endsAt) <= 0) finish(active, true);
      else setPhase({ kind: "running", sprint: active });
    } else if (!active && phase.kind === "running") {
      setPhase({ kind: "pick" });
    }
  }, [active, id, finish, phase.kind]);

  useEffect(() => {
    if (phase.kind !== "running") {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }
    tickRef.current = setInterval(() => setNow(Date.now()), 250);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [phase.kind]);

  useEffect(() => {
    if (phase.kind !== "running") return;
    if (sprintRemainingMs(phase.sprint.endsAt, now) <= 0) finish(phase.sprint, true);
  }, [phase, now, finish]);

  useEffect(() => {
    if (phase.kind !== "running") return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && sprintRemainingMs(phase.sprint.endsAt) <= 0) finish(phase.sprint, true);
    });
    return () => sub.remove();
  }, [phase, finish]);

  // The ring follows the clock while running, closes when the sprint completes, and resets for the next pick.
  useEffect(() => {
    if (phase.kind === "pick") {
      ringProgress.value = 0;
      setShownWords(0);
      return;
    }
    if (phase.kind === "running") {
      const total = phase.sprint.durationMin * 60_000;
      const fraction = Math.min(1, Math.max(0, 1 - sprintRemainingMs(phase.sprint.endsAt, now) / total));
      ringProgress.value = reduceMotion ? fraction : withTiming(fraction, { duration: 260, easing: Easing.linear });
      return;
    }
    ringProgress.value = reduceMotion
      ? phase.fraction
      : withTiming(phase.fraction, { duration: RING_CLOSE_MS, easing: Easing.out(Easing.cubic) });
    if (reduceMotion) {
      setShownWords(phase.words);
      return;
    }
    const timer = setTimeout(() => setShownWords(phase.words), RING_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [phase, now, reduceMotion, ringProgress]);
  const tickProgress = useDrawProgress(phase.kind === "done" && phase.completed, RING_CLOSE_MS);

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (!id || Array.isArray(id)) return <Redirect href="/manuscripts" />;

  async function start(durationMin: SprintDurationMin) {
    const startedAt = Date.now();
    const endsAt = sprintEndsAt(startedAt, durationMin);
    const sprint: ActiveSprint = {
      projectId: id,
      durationMin,
      startedAt,
      endsAt,
      startWords: day.words,
    };
    setActiveSprint(sprint);
    setPhase({ kind: "running", sprint });
    setNow(startedAt);
    await scheduleSprintEndNotification(
      endsAt,
      t("sprint.notifyTitle"),
      t("sprint.notifyBody", { count: durationMin })
    );
  }

  function stopEarly() {
    if (phase.kind === "running") finish(phase.sprint, false);
  }

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("sprint.title")}
        onBack={() => backOr(`/project/${id}/manuscript`)}
        floating
        onHeightChange={onHeaderHeight}
      />
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: headerHeight + 8 }}>
        {phase.kind === "pick" ? (
          <>
            <Text style={[layout.body, { marginBottom: 16 }]}>{t("sprint.blurb")}</Text>
            {SPRINT_DURATIONS_MIN.map((min, idx) => {
              const isFirst = idx === 0;
              return (
                <TapPressable
                  key={min}
                  style={[
                    isFirst ? styles.filledBtn : styles.outlinedBtn,
                    { marginBottom: 12, backgroundColor: isFirst ? colors.accent : undefined, borderColor: isFirst ? undefined : colors.line },
                  ]}
                  onPress={() => void start(min)}
                  accessibilityRole="button"
                  accessibilityLabel={t("sprint.startA11y", { count: min })}
                >
                  <Text style={[styles.btnText, { color: isFirst ? colors.panel : colors.ink }]}>
                    {t("sprint.minutes", { count: min })}
                  </Text>
                </TapPressable>
              );
            })}
          </>
        ) : null}

        {phase.kind === "running" ? (
          <>
            <View style={{ alignItems: "center", marginTop: 16 }}>
              <ProgressRing progress={ringProgress} size={CLOCK_RING} color={colors.accent} trackColor={colors.line}>
                <Text
                  style={{
                    fontSize: 48,
                    fontVariant: ["tabular-nums"],
                    color: colors.ink,
                    textAlign: "center",
                  }}
                >
                  {formatSprintClock(sprintRemainingMs(phase.sprint.endsAt, now))}
                </Text>
              </ProgressRing>
            </View>
            <Text style={[layout.cardMeta, { textAlign: "center", marginTop: 8 }]}>
              {t("sprint.runningMeta", {
                count: Math.max(0, day.words - phase.sprint.startWords),
              })}
            </Text>
            <TapPressable
              style={[layout.primaryBtn, { marginTop: 32 }]}
              onPress={() => router.push(`/project/${id}/manuscript` as never)}
              accessibilityRole="button"
              accessibilityLabel={t("sprint.writeNow")}
            >
              <Text style={layout.primaryBtnText}>{t("sprint.writeNow")}</Text>
            </TapPressable>
            <TapPressable
              feedback="dim"
              style={{ marginTop: 16, alignItems: "center" }}
              onPress={stopEarly}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.accent, fontSize: 16 }}>{t("sprint.endEarly")}</Text>
            </TapPressable>
          </>
        ) : null}

        {phase.kind === "done" ? (
          <>
            <View style={{ alignItems: "center", marginTop: 16 }}>
              <ProgressRing progress={ringProgress} size={DONE_RING} color={colors.accent} trackColor={colors.line}>
                <RollingNumber
                  value={shownWords}
                  style={{ fontSize: 44, lineHeight: 52, color: colors.ink, fontVariant: ["tabular-nums"], textAlign: "center" }}
                />
              </ProgressRing>
            </View>
            <View style={styles.doneTitleRow}>
              {phase.completed ? <DrawCheck progress={tickProgress} color={colors.accent} size={22} /> : null}
              <Text style={[layout.cardTitle, { marginTop: 0 }]}>{t("sprint.doneTitle")}</Text>
            </View>
            <Text style={[layout.body, { marginTop: 8, textAlign: "center" }]}>
              {t("sprint.doneBody", { count: phase.words, minutes: phase.durationMin })}
            </Text>
            <TapPressable
              style={[layout.primaryBtn, { marginTop: 24 }]}
              onPress={() => router.replace(`/project/${id}/manuscript`)}
              accessibilityRole="button"
            >
              <Text style={layout.primaryBtnText}>{t("sprint.backToManuscript")}</Text>
            </TapPressable>
            <TapPressable
              feedback="dim"
              style={{ marginTop: 16, alignItems: "center" }}
              onPress={() => setPhase({ kind: "pick" })}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.accent, fontSize: 16 }}>{t("sprint.again")}</Text>
            </TapPressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  filledBtn: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  outlinedBtn: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1 },
  doneTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 20 },
  btnText: { fontSize: 15, fontWeight: "600", textAlign: "center" },
});
