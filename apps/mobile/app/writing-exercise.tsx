import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, BackHandler, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import * as Clipboard from "expo-clipboard";
import { Redirect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ExerciseDone } from "../components/exercise/ExerciseDone";
import { ExerciseIntro } from "../components/exercise/ExerciseIntro";
import { ExercisePage } from "../components/exercise/ExercisePage";
import { ExerciseSettle } from "../components/exercise/ExerciseSettle";
import { ScreenErrorBoundary } from "../components/ScreenErrorBoundary";
import { ApiError } from "../lib/api";
import type { ProjectCreated } from "../lib/api/types";
import { announce } from "../lib/announce";
import { getAnalytics } from "../lib/analytics-client";
import * as haptics from "../lib/haptics";
import { markNewManuscriptArrival } from "../lib/new-manuscript-arrival";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { useStackBack } from "../lib/use-stack-back";
import {
  EMPTY_TEXTS,
  EXERCISE_ID,
  EXERCISE_PARTS,
  exerciseCopyText,
  hasWriting,
  nextPart,
  partsBefore,
  type ExercisePart,
  type ExerciseTexts,
} from "../lib/writing-exercise";
import { keepExerciseAsManuscript } from "../lib/writing-exercise-save";

const STEP_FADE_MS = 320;

type Step = { kind: "intro" } | { kind: "settle" } | { kind: "write"; part: ExercisePart } | { kind: "done" };

export default function WritingExerciseScreen() {
  return (
    <ScreenErrorBoundary>
      <WritingExerciseContent />
    </ScreenErrorBoundary>
  );
}

/**
 * The guided exercise: Observe, React, Narrate, on focus mode's calm surface. It
 * is one screen with a step at a time (intro, the settle-in, three writing
 * parts, the finish); the writing lives only in this screen's state until the
 * person keeps it, so there is nothing to sync and no AI anywhere.
 */
function WritingExerciseContent() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t, i18n } = useTranslation();
  const { user, ready } = useSession();
  const { layout } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const [step, setStep] = useState<Step>({ kind: "intro" });
  const [texts, setTexts] = useState<ExerciseTexts>(EMPTY_TEXTS);
  const [keeping, setKeeping] = useState(false);
  const [keepError, setKeepError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const startedAt = useRef<number | null>(null);
  const created = useRef<ProjectCreated | null>(null);
  const completed = useRef(false);

  const labels = {
    observe: t("exercise.parts.observe.label"),
    react: t("exercise.parts.react.label"),
    narrate: t("exercise.parts.narrate.label"),
  } satisfies Record<ExercisePart, string>;

  const leave = useCallback(() => backOr("/manuscripts"), [backOr]);

  // Closing would lose writing that lives nowhere else, so it asks first until it is kept or copied.
  const requestClose = useCallback(() => {
    const takenAway = step.kind === "done" && (created.current !== null || copied);
    if (takenAway || !hasWriting(texts)) {
      leave();
      return;
    }
    Alert.alert(t("exercise.leave.title"), t("exercise.leave.body"), [
      { text: t("exercise.leave.stay"), style: "cancel" },
      { text: t("exercise.leave.go"), style: "destructive", onPress: leave },
    ]);
  }, [step.kind, copied, texts, leave, t]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      requestClose();
      return true;
    });
    return () => sub.remove();
  }, [requestClose]);

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  function begin() {
    startedAt.current = Date.now();
    getAnalytics().track("writing_exercise_started", { exercise: EXERCISE_ID });
    setStep({ kind: "settle" });
  }

  function openPage() {
    announce(t("exercise.settle.open"));
    setStep({ kind: "write", part: "observe" });
  }

  function advance(part: ExercisePart) {
    const next = nextPart(part);
    if (next) {
      setStep({ kind: "write", part: next });
      return;
    }
    if (!completed.current) {
      completed.current = true;
      const minutes = Math.max(1, Math.round((Date.now() - (startedAt.current ?? Date.now())) / 60_000));
      getAnalytics().track("writing_exercise_completed", { exercise: EXERCISE_ID, durationMinutes: minutes });
    }
    setStep({ kind: "done" });
  }

  async function keep() {
    if (keeping) return;
    setKeepError(null);
    setKeeping(true);
    try {
      const date = new Date().toLocaleDateString(i18n.language, { month: "long", day: "numeric" });
      const project = await keepExerciseAsManuscript({
        texts,
        labels,
        title: t("exercise.done.manuscriptTitle", { date }),
        author: user?.name ?? "",
        existing: created.current,
        onCreated: (project) => {
          created.current = project;
          getAnalytics().track("project_created", { kind: "journal", isFirstProject: project.isFirstProject });
        },
      });
      haptics.success();
      markNewManuscriptArrival(project.id, project.isFirstProject);
      router.replace(`/project/${project.id}/chapters`);
    } catch (err) {
      haptics.error();
      setKeepError(err instanceof ApiError ? err.message : t("exercise.done.keepError"));
      setKeeping(false);
    }
  }

  async function copy() {
    await Clipboard.setStringAsync(exerciseCopyText(texts, labels));
    haptics.success();
    setCopied(true);
    announce(t("exercise.done.copied"));
  }

  const partLabel = (part: ExercisePart) =>
    `${t(`exercise.parts.${part}.name`)}  ${EXERCISE_PARTS.indexOf(part) + 1} / ${EXERCISE_PARTS.length}`;
  const stepKey = step.kind === "write" ? `write-${step.part}` : step.kind;

  return (
    <View style={layout.screen}>
      <Animated.View
        key={stepKey}
        entering={reduceMotion ? undefined : FadeIn.duration(STEP_FADE_MS)}
        exiting={reduceMotion ? undefined : FadeOut.duration(STEP_FADE_MS / 2)}
        style={StyleSheet.absoluteFill}
      >
        {step.kind === "intro" ? <ExerciseIntro onBegin={begin} onClose={requestClose} /> : null}
        {step.kind === "settle" ? (
          <ExerciseSettle label={partLabel("observe")} onDone={openPage} onClose={requestClose} />
        ) : null}
        {step.kind === "write" ? (
          <ExercisePage
            part={step.part}
            label={partLabel(step.part)}
            earlier={partsBefore(step.part).map((part) => ({
              part,
              label: labels[part],
              text: texts[part],
            }))}
            nextLabel={
              nextPart(step.part)
                ? t("exercise.next", { part: t(`exercise.parts.${nextPart(step.part)}.name`) })
                : t("exercise.finish")
            }
            onChangeText={(text) => setTexts((current) => ({ ...current, [step.part]: text }))}
            onNext={() => advance(step.part)}
            onClose={requestClose}
          />
        ) : null}
        {step.kind === "done" ? (
          <ExerciseDone
            texts={texts}
            labels={labels}
            busy={keeping}
            error={keepError}
            copied={copied}
            onKeep={() => void keep()}
            onCopy={() => void copy()}
            onClose={requestClose}
          />
        ) : null}
      </Animated.View>
    </View>
  );
}
