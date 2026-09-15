import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { closeOpenDrafts, parseChatSegments } from "../lib/chat-segments";
import {
  CLEAR_TIMING,
  clearSchedule,
  offersUndo,
  showsMark,
  showsThread,
  type ClearPhase,
} from "../lib/chat-clear";
import { splitErrorFooter, type ChatFailure } from "../lib/chat-errors";
import { insertionKey } from "../lib/chat-insert";
import type { ChatMessage, EditorRunStatus } from "../lib/api/types";
import type { ChatStreamState } from "../lib/ciciro-stream";
import { useAppTheme } from "../lib/settings";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { ChatClearMark } from "./ChatClearMark";
import { ChatErrorNotice } from "./ChatErrorNotice";
import { CiciroThinking } from "./CiciroThinking";
import { Glass } from "./Glass";
import { ArrowUpIcon, QuestionIcon, StopIcon } from "./icons";
import { Markdown } from "./Markdown";
import { Snackbar } from "./Snackbar";

const SEND_SIZE = 32;

/**
 * A Ciciro reply: prose on the page, drafts in a card.
 *
 * The editor's words are not a chat bubble — they are the thing the author is
 * here to read, so they run full width as formatted markdown. Only a <draft>,
 * which is manuscript text waiting on a decision, gets a frame around it.
 */
function MessageBody({
  content,
  turnId,
  live,
  inserted,
  onInsert,
  onShare,
  animate,
}: {
  content: string;
  turnId?: string | null;
  live: boolean;
  inserted: Set<string>;
  onInsert: (text: string, index: number) => void;
  onShare: (text: string) => void;
  animate: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const display = !live ? closeOpenDrafts(content) : content;
  const segments = parseChatSegments(display);
  const lastProse = segments.reduce(
    (last, seg, idx) => (seg.kind === "md" && seg.text.trim() ? idx : last),
    -1
  );

  return (
    <View>
      {segments.map((seg, idx) => {
        if (seg.kind === "md") {
          if (!seg.text.trim()) return null;
          return (
            <Markdown
              key={idx}
              source={seg.text.trim()}
              colors={colors}
              animate={animate}
              caret={live && idx === lastProse}
            />
          );
        }
        const draft = seg.text.trim();
        const key = turnId ? insertionKey(turnId, idx) : `live:${idx}`;
        const already = inserted.has(key);
        const writing = seg.open && live;
        return (
          <Animated.View
            key={idx}
            entering={animate ? FadeInDown.duration(240) : undefined}
            layout={LinearTransition.duration(200)}
            style={[styles.draft, { borderColor: colors.line, backgroundColor: colors.panel2 }]}
          >
            <Markdown source={draft || (writing ? "…" : "")} colors={colors} animate={animate} />
            {writing ? (
              <Text style={[styles.writing, { color: colors.inkSoft }]}>
                {t("ciciroTab.writing")}
              </Text>
            ) : (
              <View style={styles.draftActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={already ? t("ciciroTab.inserted") : t("ciciroTab.insert")}
                  disabled={already || !draft}
                  onPress={() => onInsert(draft, idx)}
                >
                  <Text style={{ color: already ? colors.inkSoft : colors.accent, fontWeight: "600" }}>
                    {already ? t("ciciroTab.inserted") : t("ciciroTab.insert")}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("ciciroTab.share")}
                  onPress={() => onShare(draft)}
                >
                  <Text style={{ color: colors.accent }}>{t("ciciroTab.share")}</Text>
                </Pressable>
              </View>
            )}
          </Animated.View>
        );
      })}
    </View>
  );
}

/** An assistant turn — its prose, and the failure notice if the run died. */
function AssistantTurn({
  content,
  turnId,
  live,
  inserted,
  onInsert,
  onShare,
  onRetry,
  animate,
}: {
  content: string;
  turnId?: string | null;
  live: boolean;
  inserted: Set<string>;
  onInsert: (text: string, index: number) => void;
  onShare: (text: string) => void;
  onRetry?: () => void;
  animate: boolean;
}) {
  const { colors } = useAppTheme();
  const { body, failure } = splitErrorFooter(content);
  return (
    <View style={styles.assistant}>
      <MessageBody
        content={body}
        turnId={turnId}
        live={live}
        inserted={inserted}
        onInsert={onInsert}
        onShare={onShare}
        animate={animate}
      />
      {failure ? (
        <ChatErrorNotice failure={failure} colors={colors} onRetry={onRetry} />
      ) : null}
    </View>
  );
}

/**
 * The one button at the end of the composer. It is Send while the author has
 * something to say, and Stop for as long as Ciciro is still answering — a turn
 * in flight must always have a way out.
 */
function ChatActionButton({
  onPress,
  label,
  accent,
  iconColor,
  icon,
  reduceMotion,
}: {
  onPress: () => void;
  label: string;
  accent: string;
  iconColor: string;
  icon: "send" | "stop";
  reduceMotion: boolean;
}) {
  const appear = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      appear.value = 1;
      return;
    }
    appear.value = 0;
    appear.value = withSpring(1, { damping: 15, stiffness: 240, mass: 0.6 });
  }, [appear, reduceMotion]);

  const style = useAnimatedStyle(() => ({
    width: appear.value * SEND_SIZE,
    marginLeft: appear.value * 8,
    opacity: appear.value,
    transform: [{ scale: 0.35 + appear.value * 0.65 }],
  }));

  function press() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  }

  return (
    <Animated.View style={[styles.sendWrap, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={press}
        style={({ pressed }) => [styles.send, { backgroundColor: accent, opacity: pressed ? 0.85 : 1 }]}
      >
        {icon === "stop" ? (
          <StopIcon color={iconColor} size={13} />
        ) : (
          <ArrowUpIcon color={iconColor} size={16} />
        )}
      </Pressable>
    </Animated.View>
  );
}

export function CiciroChat({
  messages,
  stream,
  streaming,
  failure,
  insertError,
  phase,
  composer,
  onComposerChange,
  onSend,
  onStop,
  onRetry,
  onClear,
  onUndoClear,
  onInsertDraft,
  insertedKeys,
  openQuestionCount = 0,
  onOpenQuestions,
  bottomInset,
}: {
  messages: ChatMessage[];
  stream: ChatStreamState;
  streaming: boolean;
  /** A turn that never reached the editor. In-transcript failures render inline. */
  failure: ChatFailure | null;
  insertError?: string | null;
  phase: EditorRunStatus | null;
  composer: string;
  onComposerChange: (value: string) => void;
  onSend: () => void;
  /** Abandons the reply in flight, keeping whatever has already arrived. */
  onStop: () => void;
  onRetry: () => void;
  /** Clears the conversation and resolves with the handle Undo restores by. */
  onClear: () => Promise<string | null>;
  onUndoClear: (token: string) => void;
  onInsertDraft: (text: string, turnId: string | null, index: number) => void;
  insertedKeys: Set<string>;
  openQuestionCount?: number;
  onOpenQuestions?: () => void;
  bottomInset: number;
}) {
  const { t } = useTranslation();
  const { layout, colors, dark } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const canSend = Boolean(composer.trim()) && !streaming;
  const animate = !reduceMotion;
  // The tail of the stream is where new words land; everything above it is read.
  const liveAnimate = animate && streaming;

  useEffect(() => {
    const id = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(id);
  }, [messages.length, stream.text]);

  // Clearing the conversation: the thread falls into the mark, the mark takes
  // the hit, and Undo stays within reach for a few seconds after.
  const [clearPhase, setClearPhase] = useState<ClearPhase>("idle");
  const [hopSignal, setHopSignal] = useState(0);
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const collapse = useSharedValue(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stopCeremony = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => stopCeremony, [stopCeremony]);

  const endCeremony = useCallback(() => {
    stopCeremony();
    setClearPhase("idle");
    setUndoToken(null);
    collapse.value = 0;
  }, [collapse, stopCeremony]);

  const runClear = useCallback(() => {
    if (clearPhase !== "idle") return;
    stopCeremony();
    setUndoToken(null);
    setClearPhase("collapsing");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    collapse.value = reduceMotion
      ? 1
      : withTiming(1, {
          duration: CLEAR_TIMING.collapseMs,
          easing: Easing.in(Easing.cubic),
        });

    // The ceremony runs on its own clock: how long the request takes should not
    // change how the clear looks.
    timers.current.push(
      setTimeout(() => setHopSignal((n) => n + 1), CLEAR_TIMING.hopAtMs)
    );
    for (const step of clearSchedule()) {
      if (step.at === 0) continue;
      timers.current.push(
        setTimeout(() => {
          setClearPhase(step.phase);
          if (step.phase === "idle") {
            setUndoToken(null);
            collapse.value = 0;
          }
        }, step.at)
      );
    }

    void onClear()
      .then(setUndoToken)
      .catch(() => {
        // The conversation is still there — put it back rather than leaving the
        // author on an empty page that is not real.
        endCeremony();
      });
  }, [clearPhase, collapse, endCeremony, onClear, reduceMotion, stopCeremony]);

  const undoClear = useCallback(() => {
    const token = undoToken;
    if (!token) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    endCeremony();
    onUndoClear(token);
  }, [endCeremony, onUndoClear, undoToken]);

  // The thread falls away from the reader and shrinks toward the centre, which
  // is where the mark is waiting for it.
  const threadStyle = useAnimatedStyle(() => ({
    opacity: 1 - collapse.value,
    transform: [
      { scale: 1 - collapse.value * 0.32 },
      { translateY: collapse.value * 18 },
    ],
  }));

  const toolLabel =
    stream.tools.length > 0
      ? t("ciciroTab.tools", { name: stream.tools[stream.tools.length - 1] })
      : phase
        ? t(`ciciroTab.phase.${phase}`)
        : t("ciciroTab.sending");

  return (
    <KeyboardAvoidingView
      style={layout.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {openQuestionCount > 0 && onOpenQuestions ? (
        <Animated.View entering={animate ? FadeIn.duration(220) : undefined}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("questions.banner", { count: openQuestionCount })}
            onPress={onOpenQuestions}
            style={({ pressed }) => [
              styles.banner,
              {
                borderColor: colors.line,
                backgroundColor: colors.accentSoft,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <QuestionIcon color={colors.accent} size={18} />
            <Text style={[styles.bannerText, { color: colors.ink }]}>
              {t("questions.banner", { count: openQuestionCount })}
            </Text>
            <Text style={{ color: colors.accent, fontSize: 13, fontWeight: "600" }}>
              {t("questions.review")}
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}

      <View style={styles.thread}>
      {showsThread(clearPhase) ? (
      <Animated.View style={[styles.threadFill, threadStyle]}>
      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          streaming ? null : (
            <Text style={[layout.body, { marginTop: 8 }]}>{t("ciciroTab.empty")}</Text>
          )
        }
        renderItem={({ item }) =>
          item.role === "user" ? (
            <Animated.View
              entering={animate ? FadeInDown.springify().damping(18).mass(0.7) : undefined}
              style={[styles.user, { backgroundColor: colors.accentSoft, borderColor: colors.line }]}
            >
              <Text style={{ color: colors.ink, fontSize: 16, lineHeight: 24 }}>{item.content}</Text>
            </Animated.View>
          ) : (
            <AssistantTurn
              content={item.content}
              turnId={item.turnId}
              live={false}
              inserted={insertedKeys}
              onInsert={(text, index) => onInsertDraft(text, item.turnId ?? null, index)}
              onShare={(text) => void Share.share({ message: text })}
              onRetry={onRetry}
              animate={false}
            />
          )
        }
        ListFooterComponent={
          streaming ? (
            <View style={styles.assistant}>
              {stream.text.trim() ? (
                <AssistantTurn
                  content={stream.text}
                  turnId={stream.turnId}
                  live
                  inserted={insertedKeys}
                  onInsert={(text, index) => onInsertDraft(text, stream.turnId, index)}
                  onShare={(text) => void Share.share({ message: text })}
                  onRetry={onRetry}
                  animate={liveAnimate}
                />
              ) : (
                <CiciroThinking colors={colors} label={toolLabel} reduceMotion={reduceMotion} />
              )}
            </View>
          ) : null
        }
      />
      </Animated.View>
      ) : null}
      {showsMark(clearPhase) ? (
        <ChatClearMark colors={colors} hopSignal={hopSignal} reduceMotion={reduceMotion} />
      ) : null}
      </View>

      {insertError ? (
        <Text style={[layout.error, { marginHorizontal: 20 }]} role="alert">
          {insertError}
        </Text>
      ) : null}

      {failure ? (
        <View style={styles.failureDock}>
          <ChatErrorNotice failure={failure} colors={colors} onRetry={onRetry} />
        </View>
      ) : null}

      {offersUndo(clearPhase, undoToken) ? (
        <Snackbar
          message={t("ciciroTab.cleared")}
          actionLabel={t("ciciroTab.undo")}
          onAction={undoClear}
          colors={colors}
          dark={dark}
          reduceMotion={reduceMotion}
        />
      ) : null}

      <View style={[styles.dock, { paddingBottom: bottomInset, backgroundColor: colors.bg }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: clearPhase !== "idle" || messages.length === 0 }}
          accessibilityLabel={t("ciciroTab.clear")}
          disabled={clearPhase !== "idle" || messages.length === 0}
          onPress={() =>
            Alert.alert(t("ciciroTab.clear"), t("ciciroTab.clearConfirm"), [
              { text: t("common.cancel"), style: "cancel" },
              { text: t("ciciroTab.clear"), style: "destructive", onPress: runClear },
            ])
          }
          style={styles.clear}
        >
          <Text
            style={{
              color: colors.inkSoft,
              fontSize: 13,
              opacity: messages.length === 0 ? 0.4 : 1,
            }}
          >
            {t("ciciroTab.clear")}
          </Text>
        </Pressable>
        <Glass dark={dark} colors={colors} radius={24} style={styles.bubble}>
          <View style={styles.composer}>
            <TextInput
              style={[styles.field, { color: colors.ink }]}
              accessibilityLabel={t("ciciroTab.composer")}
              placeholder={t("ciciroTab.composer")}
              placeholderTextColor={colors.inkSoft}
              value={composer}
              onChangeText={onComposerChange}
              multiline
            />
            {streaming ? (
              <ChatActionButton
                key="stop"
                onPress={onStop}
                label={t("ciciroTab.stop")}
                accent={colors.inkSoft}
                iconColor={colors.panel}
                icon="stop"
                reduceMotion={reduceMotion}
              />
            ) : canSend ? (
              <ChatActionButton
                key="send"
                onPress={onSend}
                label={t("ciciroTab.send")}
                accent={colors.accent}
                iconColor={colors.panel}
                icon="send"
                reduceMotion={reduceMotion}
              />
            ) : null}
          </View>
        </Glass>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  thread: { flex: 1 },
  threadFill: { flex: 1 },
  list: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  user: {
    alignSelf: "flex-end",
    maxWidth: "88%",
    marginTop: 14,
    marginBottom: 2,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  assistant: { marginBottom: 18 },
  draft: {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  writing: { fontSize: 12, marginTop: 8, fontStyle: "italic" },
  draftActions: { flexDirection: "row", gap: 16, marginTop: 12 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bannerText: { flex: 1, fontSize: 14, lineHeight: 19 },
  failureDock: { paddingHorizontal: 20 },
  dock: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  clear: {
    alignSelf: "flex-start",
    marginBottom: 8,
    marginLeft: 4,
  },
  bubble: {
    minHeight: 52,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 8,
  },
  field: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 120,
    paddingTop: Platform.OS === "ios" ? 8 : 6,
    paddingBottom: Platform.OS === "ios" ? 8 : 6,
    margin: 0,
  },
  sendWrap: {
    overflow: "hidden",
    justifyContent: "flex-end",
    alignItems: "flex-end",
  },
  send: {
    width: SEND_SIZE,
    height: SEND_SIZE,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
});
