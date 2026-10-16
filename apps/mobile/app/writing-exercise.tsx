import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, BackHandler, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import * as Clipboard from "expo-clipboard";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ExerciseDone } from "../components/exercise/ExerciseDone";
import { ExerciseIntro } from "../components/exercise/ExerciseIntro";
import { ExercisePage } from "../components/exercise/ExercisePage";
import { ExercisePicker } from "../components/exercise/ExercisePicker";
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
  emptyTexts,
  exerciseById,
  exerciseCopyText,
  hasWriting,
  namesParts,
  nextPart,
  partsBefore,
  type ExerciseDef,
  type ExercisePartDef,
  type ExerciseTexts,
} from "../lib/writing-exercise";
import { keepExerciseAsManuscript } from "../lib/writing-exercise-save";

const STEP_FADE_MS = 320;

type Step =
  | { kind: "pick" }
  | { kind: "intro" }
  | { kind: "settle" }
  | { kind: "write"; part: string }
  | { kind: "done" };

export default function WritingExerciseScreen() {
  return (
    <ScreenErrorBoundary>
      <WritingExerciseContent />
    </ScreenErrorBoundary>
  );
}

/**
 * The guided writing exercises, on focus mode's calm surface. One screen with a
 * step at a time: the list to pick from (skipped when the link names an
 * exercise by `?id=`), the exercise's intro, its settle-in if it has one, each
 * writing part, and the finish. The exercises themselves are data
 * (`EXERCISES` in lib/writing-exercise.ts); the writing lives only in this
 * screen's state until the person keeps it, so there is nothing to sync and no
 * AI anywhere.
 */
function WritingExerciseContent() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t, i18n } = useTranslation();
  const { user, ready } = useSession();
  const { layout } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const params = useLocalSearchParams<{ id?: string }>();
  const [exercise, setExercise] = useState<ExerciseDef | null>(() => exerciseById(params.id));
  const [step, setStep] = useState<Step>(() => (exerciseById(params.id) ? { kind: "intro" } : { kind: "pick" }));
  const [texts, setTexts] = useState<ExerciseTexts>({});
  const [keeping, setKeeping] = useState(false);
  const [keepError, setKeepError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const startedAt = useRef<number | null>(null);
  const created = useRef<ProjectCreated | null>(null);
  const kept = useRef(false);
  const completed = useRef(false);

  const base = exercise ? `exercise.items.${exercise.id}` : "";
  const labels: Record<string, string> = Object.fromEntries(
    (exercise?.parts ?? []).map((part) => [part.id, t(`${base}.parts.${part.id}.label`)])
  );

  const leave = useCallback(() => backOr("/manuscripts"), [backOr]);

  // Closing would lose writing that lives nowhere else, so it asks first until it is kept or copied.
  const requestClose = useCallback(() => {
    const takenAway = step.kind === "done" && (kept.current || copied);
    if (takenAway || !exercise || !hasWriting(exercise, texts)) {
      leave();
      return;
    }
    Alert.alert(t("exercise.leave.title"), t("exercise.leave.body"), [
      { text: t("exercise.leave.stay"), style: "cancel" },
      { text: t("exercise.leave.go"), style: "destructive", onPress: leave },
    ]);
  }, [step.kind, copied, exercise, texts, leave, t]);

  const backToList = useCallback(() => {
    setExercise(null);
    setTexts({});
    setStep({ kind: "pick" });
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (step.kind === "intro") backToList();
      else requestClose();
      return true;
    });
    return () => sub.remove();
  }, [step.kind, backToList, requestClose]);

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  function pick(chosen: ExerciseDef) {
    setExercise(chosen);
    setTexts(emptyTexts(chosen));
    setStep({ kind: "intro" });
  }

  function begin(current: ExerciseDef) {
    startedAt.current = Date.now();
    getAnalytics().track("writing_exercise_started", { exercise: current.id });
    setTexts(emptyTexts(current));
    setStep(current.settle ? { kind: "settle" } : { kind: "write", part: current.parts[0]!.id });
  }

  function openPage(current: ExerciseDef) {
    announce(t(`exercise.items.${current.id}.settle.open`));
    setStep({ kind: "write", part: current.parts[0]!.id });
  }

  function advance(current: ExerciseDef, part: ExercisePartDef) {
    const next = nextPart(current, part.id);
    if (next) {
      setStep({ kind: "write", part: next.id });
      return;
    }
    if (!completed.current) {
      completed.current = true;
      const minutes = Math.max(1, Math.round((Date.now() - (startedAt.current ?? Date.now())) / 60_000));
      getAnalytics().track("writing_exercise_completed", { exercise: current.id, durationMinutes: minutes });
    }
    setStep({ kind: "done" });
  }

  async function keep() {
    if (keeping || !exercise) return;
    setKeepError(null);
    setKeeping(true);
    try {
      const date = new Date().toLocaleDateString(i18n.language, { month: "long", day: "numeric" });
      const project = await keepExerciseAsManuscript({
        exercise,
        texts,
        labels,
        title: t("exercise.done.manuscriptTitle", { name: t(`${base}.title`), date }),
        author: user?.name ?? "",
        existing: created.current,
        onCreated: (project) => {
          created.current = project;
          getAnalytics().track("project_created", { kind: "journal", isFirstProject: project.isFirstProject });
        },
      });
      kept.current = true;
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
    if (!exercise) return;
    await Clipboard.setStringAsync(exerciseCopyText(exercise, texts, labels));
    haptics.success();
    setCopied(true);
    announce(t("exercise.done.copied"));
  }

  // A part's name and where it sits in the exercise; a lone part is just its name.
  const partLabel = (current: ExerciseDef, part: ExercisePartDef) => {
    const name = t(`exercise.items.${current.id}.parts.${part.id}.name`);
    return namesParts(current) ? `${name}  ${current.parts.indexOf(part) + 1} / ${current.parts.length}` : name;
  };
  const writingPart = exercise && step.kind === "write" ? exercise.parts.find((p) => p.id === step.part) : undefined;
  const stepKey = step.kind === "write" ? `write-${step.part}` : step.kind;

  return (
    <View style={layout.screen}>
      <Animated.View
        key={stepKey}
        entering={reduceMotion ? undefined : FadeIn.duration(STEP_FADE_MS)}
        exiting={reduceMotion ? undefined : FadeOut.duration(STEP_FADE_MS / 2)}
        style={StyleSheet.absoluteFill}
      >
        {step.kind === "pick" ? <ExercisePicker onPick={pick} onClose={requestClose} /> : null}
        {step.kind === "intro" && exercise ? (
          <ExerciseIntro
            exercise={exercise}
            onBegin={() => begin(exercise)}
            onClose={requestClose}
            onBack={backToList}
          />
        ) : null}
        {step.kind === "settle" && exercise?.settle ? (
          <ExerciseSettle
            exercise={exercise}
            settle={exercise.settle}
            label={partLabel(exercise, exercise.parts[0]!)}
            onDone={() => openPage(exercise)}
            onClose={requestClose}
          />
        ) : null}
        {exercise && writingPart ? (
          <ExercisePage
            exercise={exercise}
            part={writingPart}
            label={partLabel(exercise, writingPart)}
            earlier={partsBefore(exercise, writingPart.id).map((earlier) => ({
              part: earlier.id,
              label: labels[earlier.id] ?? "",
              text: texts[earlier.id] ?? "",
            }))}
            nextLabel={
              nextPart(exercise, writingPart.id)
                ? t("exercise.next", {
                    part: t(`${base}.parts.${nextPart(exercise, writingPart.id)!.id}.name`),
                  })
                : t("exercise.finish")
            }
            onChangeText={(text) => setTexts((current) => ({ ...current, [writingPart.id]: text }))}
            onNext={() => advance(exercise, writingPart)}
            onClose={requestClose}
          />
        ) : null}
        {step.kind === "done" && exercise ? (
          <ExerciseDone
            exercise={exercise}
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
