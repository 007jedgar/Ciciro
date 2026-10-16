import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, BackHandler, StyleSheet, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Image } from "expo-image";
import { useNavigation, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppHeader, useMeasuredAppHeaderHeight } from "./AppHeader";
import { CiciroThinking } from "./CiciroThinking";
import { DrawCheck, useDrawProgress } from "./DrawCheck";
import { TapPressable } from "./TapPressable";
import { CapturePage, type CaptureNotice } from "./scan-notes/CapturePage";
import { DestinationPage } from "./scan-notes/DestinationPage";
import { ReviewPage } from "./scan-notes/ReviewPage";
import { ApiError, useBibleIndexQuery, useScanNotesApplyMutation } from "../lib/api";
import type { ScanApplyResponse, ScanReadingResponse } from "../lib/api/types";
import { getAnalytics } from "../lib/analytics-client";
import { announce } from "../lib/announce";
import { bibleFileHref, bibleFileLabel, withCoreBibleFiles } from "../lib/bible-files";
import { canvasHref } from "../lib/canvas";
import * as haptics from "../lib/haptics";
import {
  addScanPages,
  applyRequest,
  removeScanPage,
  scanFailure,
  suggestDestination,
  type ScanDestinationChoice,
  type ScanFailure,
  type ScanPageDraft,
} from "../lib/notes-scan";
import { discardPhotos, pickPhotos, readScanPages, takePhoto, type CaptureResult } from "../lib/notes-scan-capture";
import { useAppTheme } from "../lib/settings";
import { useIsOnline } from "../lib/use-online";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { useStackBack } from "../lib/use-stack-back";

type Step = "capture" | "reading" | "empty" | "review" | "destination" | "done";

let pageCounter = 0;
const nextPageId = () => `scan-page-${++pageCounter}`;

function Reading({ pages, onCancel }: { pages: readonly ScanPageDraft[]; onCancel: () => void }) {
  const { t } = useTranslation();
  const { colors, layout } = useAppTheme();
  const reduceMotion = useReduceMotion();
  return (
    <View testID="scan-reading" style={styles.center}>
      <View style={styles.readingStrip}>
        {pages.map((page) => (
          <View key={page.id} style={[styles.readingThumb, { borderColor: colors.line }]}>
            <Image source={{ uri: page.uri }} contentFit="cover" style={StyleSheet.absoluteFill} />
          </View>
        ))}
      </View>
      <CiciroThinking colors={colors} reduceMotion={reduceMotion} />
      <Text style={[layout.cardTitle, styles.centerTitle]}>{t("scanNotes.reading.title")}</Text>
      <Text style={[layout.body, styles.centerBody]}>{t("scanNotes.reading.body")}</Text>
      <TapPressable
        testID="scan-cancel-read"
        feedback="dim"
        style={layout.ghostBtn}
        accessibilityRole="button"
        onPress={onCancel}
      >
        <Text style={layout.ghostBtnText}>{t("scanNotes.reading.cancel")}</Text>
      </TapPressable>
    </View>
  );
}

function Empty({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { layout } = useAppTheme();
  return (
    <View testID="scan-empty" style={styles.center}>
      <Text style={[layout.cardTitle, styles.centerTitle]}>{t("scanNotes.empty.title")}</Text>
      <Text style={[layout.body, styles.centerBody]}>{t("scanNotes.empty.body")}</Text>
      <TapPressable
        testID="scan-empty-back"
        style={[layout.primaryBtn, styles.wide]}
        accessibilityRole="button"
        onPress={onBack}
      >
        <Text style={layout.primaryBtnText}>{t("scanNotes.empty.back")}</Text>
      </TapPressable>
    </View>
  );
}

function Done({
  result,
  onOpen,
  onMore,
  onFinish,
}: {
  result: ScanApplyResponse;
  onOpen: () => void;
  onMore: () => void;
  onFinish: () => void;
}) {
  const { t } = useTranslation();
  const { colors, layout } = useAppTheme();
  const progress = useDrawProgress(true, 80, { drawOnMount: true });
  const where = result.destination === "bible" ? bibleFileLabel(result.path) : "";
  const message =
    result.destination === "canvas"
      ? t("scanNotes.done.canvasAdded", { count: result.cards })
      : t(result.created ? "scanNotes.done.bibleCreated" : "scanNotes.done.bibleAdded", { where });
  useEffect(() => announce(message), [message]);
  return (
    <View testID="scan-done" style={styles.center}>
      <View style={[styles.tick, { borderColor: colors.accent }]}>
        <DrawCheck progress={progress} color={colors.accent} size={34} strokeWidth={2.2} />
      </View>
      <Text style={[layout.cardTitle, styles.centerTitle]}>{t("scanNotes.done.title")}</Text>
      <Text testID="scan-done-message" style={[layout.body, styles.centerBody]}>
        {message}
      </Text>
      <TapPressable
        testID="scan-open"
        style={[layout.primaryBtn, styles.wide]}
        accessibilityRole="button"
        onPress={onOpen}
      >
        <Text style={layout.primaryBtnText}>
          {result.destination === "canvas" ? t("scanNotes.done.openCanvas") : t("scanNotes.done.openBible", { where })}
        </Text>
      </TapPressable>
      <TapPressable testID="scan-more" style={layout.ghostBtn} accessibilityRole="button" feedback="dim" onPress={onMore}>
        <Text style={layout.ghostBtnText}>{t("scanNotes.done.more")}</Text>
      </TapPressable>
      <TapPressable testID="scan-finish" style={layout.ghostBtn} accessibilityRole="button" feedback="dim" onPress={onFinish}>
        <Text style={[layout.ghostBtnText, { color: colors.inkSoft }]}>{t("scanNotes.done.finish")}</Text>
      </TapPressable>
    </View>
  );
}

/**
 * Scan notes: photograph handwritten or printed notes, read them into text,
 * check the text, then add it to the story bible or the canvas. Each step is
 * one page of this screen. Nothing is added until the last tap, the photos stay
 * on the phone only while it is open, and whatever fails (no camera, no
 * connection, an unreadable page) leaves the photos and the text where they are.
 */
export function ScanNotes({ projectId, to }: { projectId: string; to?: "bible" | "canvas" }) {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const { backOr } = useStackBack();
  const { settings, layout } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const online = useIsOnline();
  const [headerHeight, onHeaderHeight] = useMeasuredAppHeaderHeight();
  const index = useBibleIndexQuery(projectId);
  const apply = useScanNotesApplyMutation();

  const [step, setStep] = useState<Step>("capture");
  const [pages, setPages] = useState<ScanPageDraft[]>([]);
  const [notice, setNotice] = useState<CaptureNotice | null>(null);
  const [failure, setFailure] = useState<ScanFailure | null>(null);
  const [reading, setReading] = useState<ScanReadingResponse | null>(null);
  const [text, setText] = useState("");
  const [choice, setChoice] = useState<ScanDestinationChoice | null>(null);
  const [suggested, setSuggested] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanApplyResponse | null>(null);
  const abort = useRef<AbortController | null>(null);
  const recognized = useRef("");
  const everPicked = useRef(new Set<string>());

  const files = useMemo(
    () => withCoreBibleFiles(index.data ?? [], t("bible.emptySummary")),
    [index.data, t]
  );

  // Photos are private notes: whatever this screen put in the cache goes when it closes.
  useEffect(() => {
    const picked = everPicked.current;
    return () => {
      abort.current?.abort();
      discardPhotos([...picked]);
    };
  }, []);

  const hasWork = step === "reading" || step === "review" || step === "destination";

  // Swiping away would drop text that cost a read: closing asks first while there is some.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !hasWork });
  }, [navigation, hasWork]);

  const leave = useCallback(() => backOr(`/project/${projectId}/chapters`), [backOr, projectId]);

  const requestClose = useCallback(() => {
    if (!hasWork) {
      leave();
      return;
    }
    Alert.alert(t("scanNotes.leave.title"), t("scanNotes.leave.body"), [
      { text: t("scanNotes.leave.stay"), style: "cancel" },
      {
        text: t("scanNotes.leave.go"),
        style: "destructive",
        onPress: () => {
          abort.current?.abort();
          leave();
        },
      },
    ]);
  }, [hasWork, leave, t]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      requestClose();
      return true;
    });
    return () => sub.remove();
  }, [requestClose]);

  function gather(captured: CaptureResult) {
    if (captured.kind === "cancelled") return;
    if (captured.kind === "denied" || captured.kind === "unavailable") {
      setNotice(captured);
      return;
    }
    setNotice(null);
    setFailure(null);
    for (const photo of captured.photos) everPicked.current.add(photo.uri);
    const added = addScanPages(pages, captured.photos, nextPageId);
    setPages(added.pages);
    if (added.dropped > 0) setNotice({ kind: "tooMany" });
  }

  async function take() {
    gather(await takePhoto());
  }

  async function pick() {
    gather(await pickPhotos(Math.max(1, 6 - pages.length)));
  }

  async function read() {
    if (pages.length === 0 || !online) return;
    setFailure(null);
    setNotice(null);
    const controller = new AbortController();
    abort.current = controller;
    setStep("reading");
    announce(t("scanNotes.reading.announce"));
    try {
      const reply = await readScanPages(projectId, pages, controller.signal);
      if (controller.signal.aborted) return;
      getAnalytics().track("notes_scan_read", { pages: pages.length, outcome: reply.status });
      setReading(reply);
      if (reply.status === "unreadable") {
        setStep("empty");
        return;
      }
      recognized.current = reply.text;
      setText(reply.text);
      // Coming from the empty canvas already says where the notes go; otherwise the reading suggests one.
      const suggestion = to === "canvas" ? ({ kind: "canvas" } as const) : suggestDestination(reply, files);
      setChoice(suggestion);
      setSuggested(suggestion !== null && to !== "canvas");
      setApplyError(null);
      haptics.success();
      setStep("review");
    } catch (error) {
      if (controller.signal.aborted) return;
      const failed = scanFailure(error);
      getAnalytics().track("notes_scan_read", {
        pages: pages.length,
        outcome: failed.kind === "offline" ? "offline" : failed.kind === "limit" ? "limit" : "error",
      });
      haptics.warning();
      setFailure(failed);
      setStep("capture");
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }

  function cancelRead() {
    abort.current?.abort();
    abort.current = null;
    setStep("capture");
  }

  async function add() {
    const request = applyRequest(choice, text);
    if (!request || apply.isPending) return;
    setApplyError(null);
    try {
      const added = await apply.mutateAsync({ projectId, body: request });
      getAnalytics().track("notes_scan_added", {
        destination:
          added.destination === "canvas" ? "canvas" : request.destination.type === "bible" && request.destination.mode === "new" ? "bible_new" : "bible_file",
        pages: pages.length,
        edited: text.trim() !== recognized.current.trim(),
      });
      haptics.success();
      setResult(added);
      setStep("done");
    } catch (error) {
      haptics.warning();
      const failed = scanFailure(error);
      setApplyError(
        failed.kind === "offline"
          ? t("scanNotes.error.offline")
          : error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 402
            ? error.message
            : t("scanNotes.error.add")
      );
    }
  }

  function again() {
    setReading(null);
    setText("");
    setChoice(null);
    setSuggested(false);
    setResult(null);
    setApplyError(null);
    setFailure(null);
    setNotice(null);
    discardPhotos(pages.map((page) => page.uri));
    setPages([]);
    setStep("capture");
  }

  function open() {
    if (!result) return;
    if (result.destination === "canvas") router.push(canvasHref(projectId) as never);
    else router.push(bibleFileHref(projectId, result.path) as never);
  }

  let body: ReactNode;
  switch (step) {
    case "reading":
      body = <Reading pages={pages} onCancel={cancelRead} />;
      break;
    case "empty":
      body = <Empty onBack={() => setStep("capture")} />;
      break;
    case "review":
      body = reading ? (
        <ReviewPage
          pages={pages}
          reading={reading}
          text={text}
          autoCorrect={settings.autoCorrect}
          onChangeText={setText}
          onNext={() => setStep("destination")}
          onScanAgain={() => setStep("capture")}
        />
      ) : null;
      break;
    case "destination":
      body = (
        <DestinationPage
          choice={choice}
          suggested={suggested}
          files={files}
          text={text}
          pending={apply.isPending}
          error={applyError}
          onChoose={(next) => {
            setSuggested(false);
            setApplyError(null);
            setChoice(next);
          }}
          onAdd={() => void add()}
          onBack={() => setStep("review")}
        />
      );
      break;
    case "done":
      body = result ? <Done result={result} onOpen={open} onMore={again} onFinish={leave} /> : null;
      break;
    default:
      body = (
        <CapturePage
          pages={pages}
          notice={notice}
          failure={failure}
          online={online}
          onTake={() => void take()}
          onPick={() => void pick()}
          onRemove={(id) => {
            const gone = pages.find((page) => page.id === id);
            setPages(removeScanPage(pages, id));
            setNotice(null);
            setFailure(null);
            if (gone) discardPhotos([gone.uri]);
          }}
          onRead={() => void read()}
        />
      );
  }

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("scanNotes.title")}
        floating
        onBack={requestClose}
        backAccessibilityLabel={t("bible.backToManuscript")}
        onHeightChange={onHeaderHeight}
      />
      <KeyboardAwareScrollView
        testID="scan-notes"
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: headerHeight + 8, paddingBottom: 48, flexGrow: 1 }}
        scrollIndicatorInsets={{ top: headerHeight }}
      >
        <Animated.View key={step} entering={reduceMotion ? undefined : FadeInDown.duration(240)} style={{ flexGrow: 1 }}>
          {body}
        </Animated.View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", paddingTop: 24 },
  centerTitle: { fontSize: 22, textAlign: "center", marginTop: 20 },
  centerBody: { textAlign: "center", marginTop: 8, maxWidth: 320 },
  wide: { alignSelf: "stretch", marginTop: 24 },
  readingStrip: { flexDirection: "row", gap: 8, marginBottom: 28, justifyContent: "center", flexWrap: "wrap" },
  readingThumb: { width: 56, height: 74, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden", opacity: 0.7 },
  tick: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
});
