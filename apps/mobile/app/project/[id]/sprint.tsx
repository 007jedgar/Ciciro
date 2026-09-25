import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppHeader, useAppHeaderHeight } from "../../../components/AppHeader";
import { useSession } from "../../../lib/session";
import { useAppTheme } from "../../../lib/settings";
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
  | { kind: "done"; durationMin: SprintDurationMin; words: number };

export default function SprintScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { user, ready } = useSession();
  const { layout, colors } = useAppTheme();
  const headerHeight = useAppHeaderHeight();
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

  const finish = useCallback(
    (sprint: ActiveSprint) => {
      if (finishingRef.current) return;
      if (!getActiveSprint()) return;
      finishingRef.current = true;
      void cancelSprintEndNotification();
      const words = sprintWordsWritten(sprint.startWords, day.words);
      closeSprintSitting(sprint.projectId, sprint.startedAt, words);
      setActiveSprint(null);
      setPhase({ kind: "done", durationMin: sprint.durationMin, words });
      finishingRef.current = false;
    },
    [day.words]
  );

  useEffect(() => {
    if (!id || Array.isArray(id)) return;
    if (active && active.projectId === id) {
      if (sprintRemainingMs(active.endsAt) <= 0) finish(active);
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
    if (sprintRemainingMs(phase.sprint.endsAt, now) <= 0) finish(phase.sprint);
  }, [phase, now, finish]);

  useEffect(() => {
    if (phase.kind !== "running") return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && sprintRemainingMs(phase.sprint.endsAt) <= 0) finish(phase.sprint);
    });
    return () => sub.remove();
  }, [phase, finish]);

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
    if (phase.kind === "running") finish(phase.sprint);
  }

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("sprint.title")}
        onBack={() => backOr(`/project/${id}/manuscript`)}
        floating
      />
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: headerHeight + 24 }}>
        {phase.kind === "pick" ? (
          <>
            <Text style={[layout.body, { marginBottom: 16 }]}>{t("sprint.blurb")}</Text>
            {SPRINT_DURATIONS_MIN.map((min) => (
              <Pressable
                key={min}
                style={[layout.primaryBtn, { marginBottom: 12 }]}
                onPress={() => void start(min)}
                accessibilityRole="button"
                accessibilityLabel={t("sprint.startA11y", { count: min })}
              >
                <Text style={layout.primaryBtnText}>{t("sprint.minutes", { count: min })}</Text>
              </Pressable>
            ))}
          </>
        ) : null}

        {phase.kind === "running" ? (
          <>
            <Text
              style={{
                fontSize: 48,
                fontVariant: ["tabular-nums"],
                color: colors.ink,
                textAlign: "center",
                marginTop: 24,
              }}
            >
              {formatSprintClock(sprintRemainingMs(phase.sprint.endsAt, now))}
            </Text>
            <Text style={[layout.cardMeta, { textAlign: "center", marginTop: 8 }]}>
              {t("sprint.runningMeta", {
                count: Math.max(0, day.words - phase.sprint.startWords),
              })}
            </Text>
            <Pressable
              style={[layout.primaryBtn, { marginTop: 32 }]}
              onPress={() => router.push(`/project/${id}/manuscript` as never)}
              accessibilityRole="button"
              accessibilityLabel={t("sprint.writeNow")}
            >
              <Text style={layout.primaryBtnText}>{t("sprint.writeNow")}</Text>
            </Pressable>
            <Pressable
              style={{ marginTop: 16, alignItems: "center" }}
              onPress={stopEarly}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.accent, fontSize: 16 }}>{t("sprint.endEarly")}</Text>
            </Pressable>
          </>
        ) : null}

        {phase.kind === "done" ? (
          <>
            <Text style={[layout.cardTitle, { marginTop: 16 }]}>{t("sprint.doneTitle")}</Text>
            <Text style={[layout.body, { marginTop: 8 }]}>
              {t("sprint.doneBody", { count: phase.words, minutes: phase.durationMin })}
            </Text>
            <Pressable
              style={[layout.primaryBtn, { marginTop: 24 }]}
              onPress={() => router.replace(`/project/${id}/manuscript`)}
              accessibilityRole="button"
            >
              <Text style={layout.primaryBtnText}>{t("sprint.backToManuscript")}</Text>
            </Pressable>
            <Pressable
              style={{ marginTop: 16 }}
              onPress={() => setPhase({ kind: "pick" })}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.accent, fontSize: 16 }}>{t("sprint.again")}</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}
