import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  FlatList,
  Platform,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
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
  type SharedValue,
} from "react-native-reanimated";
import * as haptics from "../lib/haptics";
import { LinearGradient } from "expo-linear-gradient";
import { KeyboardStickyView, useKeyboardState } from "react-native-keyboard-controller";
import { useTranslation } from "react-i18next";
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
import {
  CHAT_JUMP_FADE_SCREENS,
  CHAT_JUMP_START_SCREENS,
  anchorFooterMinHeight,
  jumpChipOpacity,
  promptAnchorGap,
} from "../lib/chat-scroll";
import { closeOpenDrafts, parseChatSegments } from "../lib/chat-segments";
import { scriptDisplayText } from "../lib/manuscript-kind";
import type { ChatMessage, EditorRunStatus } from "../lib/api/types";
import type { ChatStreamState } from "../lib/ciciro-stream";
import { DEFAULT_EDIT_MODE, type EditMode } from "../lib/edit-mode";
import { useAppTheme } from "../lib/settings";
import type { ColorTokens } from "../lib/theme";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { BrandMark } from "./BrandMark";
import { ChatClearMark } from "./ChatClearMark";
import { ChatErrorNotice } from "./ChatErrorNotice";
import { EditModeToggle } from "./EditModeToggle";
import { CiciroThinking } from "./CiciroThinking";
import { alpha, Glass } from "./Glass";
import { ArrowDownIcon, ArrowUpIcon, QuestionIcon, SparkleIcon, StopIcon } from "./icons";
import { Markdown } from "./Markdown";
import { ScriptDraft } from "./ScriptDraft";
import { Snackbar } from "./Snackbar";
import { TapPressable } from "./TapPressable";
import { AlertText } from "./AlertText";
import { EASE_OUT, PRESS_SCALE } from "../lib/motion";

/** A circle nested in the pill, inset so it shares the field's curve. */
const SEND_SIZE = 36;
/** How far above the dock the bottom fade starts. */
const FADE_LEAD = 130;
/** Air between the composer and the top of the keyboard. */
const KEYBOARD_GAP = 10;
/** Data index 0 of the reversed thread is the held prompt; the list skips its own header. */
const HOLD_PROMPT_ROW = { minIndexForVisible: 0 } as const;

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
  screenplay,
}: {
  content: string;
  turnId?: string | null;
  live: boolean;
  inserted: Set<string>;
  onInsert: (text: string, index: number) => void;
  onShare: (text: string) => void;
  animate: boolean;
  /** A script's draft is marked lines: shown set as a script, shared without the marks. */
  screenplay: boolean;
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
        const draftStyle = [styles.draft, { borderColor: colors.line, backgroundColor: colors.panel2 }];
        const draftBody = (
          <>
            {screenplay && draft ? (
              <ScriptDraft text={draft} colors={colors} />
            ) : (
              <Markdown source={draft || (writing ? "…" : "")} colors={colors} animate={animate} />
            )}
            {writing ? (
              <Text style={[styles.writing, { color: colors.inkSoft }]}>
                {t("ciciroTab.writing")}
              </Text>
            ) : (
              <View style={styles.draftActions}>
                <TapPressable
                  feedback="dim"
                  accessibilityRole="button"
                  accessibilityLabel={already ? t("ciciroTab.inserted") : t("ciciroTab.insert")}
                  disabled={already || !draft}
                  onPress={() => onInsert(draft, idx)}
                >
                  <Text style={{ color: already ? colors.inkSoft : colors.accent, fontWeight: "600" }}>
                    {already ? t("ciciroTab.inserted") : t("ciciroTab.insert")}
                  </Text>
                </TapPressable>
                <TapPressable
                  feedback="dim"
                  accessibilityRole="button"
                  accessibilityLabel={t("ciciroTab.share")}
                  onPress={() => onShare(screenplay ? scriptDisplayText(draft) : draft)}
                >
                  <Text style={{ color: colors.accent }}>{t("ciciroTab.share")}</Text>
                </TapPressable>
              </View>
            )}
          </>
        );
        if (!animate) {
          return (
            <View key={idx} style={draftStyle}>
              {draftBody}
            </View>
          );
        }
        return (
          <Animated.View
            key={idx}
            entering={FadeInDown.duration(240)}
            layout={LinearTransition.duration(200)}
            style={draftStyle}
          >
            {draftBody}
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
  screenplay,
}: {
  content: string;
  turnId?: string | null;
  live: boolean;
  inserted: Set<string>;
  onInsert: (text: string, index: number) => void;
  onShare: (text: string) => void;
  onRetry?: () => void;
  animate: boolean;
  screenplay: boolean;
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
        screenplay={screenplay}
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

  return (
    <Animated.View style={[styles.sendWrap, style]}>
      <TapPressable
        scale={PRESS_SCALE.fab}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={[styles.send, { backgroundColor: accent }]}
      >
        {icon === "stop" ? (
          <StopIcon color={iconColor} size={13} />
        ) : (
          <ArrowUpIcon color={iconColor} size={16} />
        )}
      </TapPressable>
    </Animated.View>
  );
}

/**
 * The thread's collapse lives in its own component so the worklet does not
 * share a closure with the list refs. A ref captured by a worklet is frozen,
 * and writing `.current` afterwards is the warning on the way into chat.
 */
function ThreadFade({
  collapse,
  children,
}: {
  collapse: SharedValue<number>;
  children: ReactNode;
}) {
  const threadStyle = useAnimatedStyle(() => ({
    opacity: 1 - collapse.value,
    transform: [
      { scale: 1 - collapse.value * 0.32 },
      { translateY: collapse.value * 18 },
    ],
  }));
  return <Animated.View style={[styles.threadFill, threadStyle]}>{children}</Animated.View>;
}

function JumpChip({
  opacity,
  children,
}: {
  opacity: SharedValue<number>;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View testID="chat-jump" style={style}>
      {children}
    </Animated.View>
  );
}

/** The gap the open chip row leaves above the Clear chat row. */
const CHIP_ROW_GAP = 10;
const CHIPS_MS = 240;

/**
 * The quick-action chips, folding open above the Clear chat row and back down
 * into it. The row stays mounted so it can animate both ways: its layout height
 * grows from nothing to the chips' own height (the dock is pinned at its foot,
 * so the dock's top rises with it), while the chips fade and rise into place.
 */
function SuggestionChips({
  open,
  reduceMotion,
  children,
}: {
  open: boolean;
  reduceMotion: boolean;
  children: ReactNode;
}) {
  const progress = useSharedValue(open ? 1 : 0);
  const height = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: reduceMotion ? 0 : CHIPS_MS, easing: EASE_OUT });
  }, [open, reduceMotion, progress]);
  const frameStyle = useAnimatedStyle(() => ({ height: height.value * progress.value }));
  const rowStyle = useAnimatedStyle(() => ({
    opacity: height.value > 0 ? progress.value : 0,
    transform: [
      { translateY: (1 - progress.value) * 14 },
      { scale: reduceMotion ? 1 : 0.94 + 0.06 * progress.value },
    ],
  }));
  return (
    <Animated.View
      pointerEvents={open ? "box-none" : "none"}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      style={[styles.actionsFrame, frameStyle]}
    >
      <Animated.ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onLayout={(event) => {
          height.value = event.nativeEvent.layout.height;
        }}
        style={[styles.actionsScroll, rowStyle]}
        contentContainerStyle={styles.actionsRow}
        testID="chat-quick-actions"
      >
        {children}
      </Animated.ScrollView>
    </Animated.View>
  );
}

/**
 * The empty thread, before the first message: the brand mark and one
 * instructional line that points at the chips docked above the composer.
 * Once the conversation has begun the chips tuck away behind a Suggestions
 * button instead of crowding every screen.
 */
function ChatEmptyState({ colors, style }: { colors: ColorTokens; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  // The inverted list clones its empty component with the counter-flip that
  // turns it upright as `style`; dropping it leaves the text upside down.
  return (
    <View style={[styles.emptyState, style]}>
      <BrandMark size={40} />
      <Text style={[styles.emptyText, { color: colors.inkSoft }]}>{t("ciciroTab.empty")}</Text>
    </View>
  );
}

const ChatTurn = memo(function ChatTurn({
  message,
  anchored,
  measureReply,
  enter,
  inserted,
  onInsertDraft,
  onRetry,
  onPromptHeight,
  onReplyHeight,
  screenplay,
}: {
  message: ChatMessage;
  anchored: boolean;
  measureReply: boolean;
  screenplay: boolean;
  /** Fade in a user bubble that arrived after the transcript was already open. */
  enter: boolean;
  inserted: Set<string>;
  onInsertDraft: (text: string, turnId: string | null, index: number) => void;
  onRetry: () => void;
  onPromptHeight: (height: number) => void;
  onReplyHeight: (height: number) => void;
}) {
  const { colors } = useAppTheme();

  if (message.role === "user") {
    const body = (
      <Text style={{ color: colors.ink, fontSize: 16, lineHeight: 24 }}>{message.content}</Text>
    );
    const frameStyle = [styles.user, { backgroundColor: colors.accentSoft, borderColor: colors.line }];
    if (!enter) {
      return (
        <View
          testID={anchored ? "chat-prompt" : undefined}
          onLayout={
            anchored
              ? (event) => onPromptHeight(event.nativeEvent.layout.height)
              : undefined
          }
          style={frameStyle}
        >
          {body}
        </View>
      );
    }
    return (
      <Animated.View entering={FadeInDown.springify().damping(18).mass(0.7)} style={frameStyle}>
        {body}
      </Animated.View>
    );
  }

  return (
    <View
      testID={measureReply ? "chat-settled-reply" : undefined}
      onLayout={
        measureReply
          ? (event) => onReplyHeight(event.nativeEvent.layout.height)
          : undefined
      }
    >
      <AssistantTurn
        content={message.content}
        turnId={message.turnId}
        live={false}
        inserted={inserted}
        onInsert={(text, index) => onInsertDraft(text, message.turnId ?? null, index)}
        onShare={(text) => void Share.share({ message: text })}
        onRetry={onRetry}
        animate={false}
        screenplay={screenplay}
      />
    </View>
  );
});

export function CiciroChat({
  messages,
  stream,
  streaming,
  failure,
  insertError,
  phase,
  composer,
  onComposerChange,
  focusComposerKey = 0,
  onSend,
  onStop,
  onRetry,
  onClear,
  onUndoClear,
  editMode = DEFAULT_EDIT_MODE,
  onEditModeChange,
  onInsertDraft,
  insertedKeys,
  openQuestionCount = 0,
  onOpenQuestions,
  quickActions,
  onQuickAction,
  bottomInset,
  topInset = 0,
  screenplay = false,
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
  /** Changes when the composer should take focus (a Comment from the editor starts a message there). */
  focusComposerKey?: number;
  onSend: () => void;
  /** Abandons the reply in flight, keeping whatever has already arrived. */
  onStop: () => void;
  onRetry: () => void;
  /** Clears the conversation and resolves with the handle Undo restores by. */
  onClear: () => Promise<string | null>;
  onUndoClear: (token: string) => void;
  /** Allow edits or Chat only, for this conversation. The switch shows only with a handler. */
  editMode?: EditMode;
  onEditModeChange?: (mode: EditMode) => void;
  onInsertDraft: (text: string, turnId: string | null, index: number) => void;
  insertedKeys: Set<string>;
  openQuestionCount?: number;
  onOpenQuestions?: () => void;
  /**
   * Chips above the composer that send a ready-made brief. Shown on an empty chat; once the
   * conversation has begun they sit behind a sparkle button and close again when one is
   * used. Always hidden while a reply streams or the keyboard is up.
   */
  quickActions?: { id: string; label: string }[];
  onQuickAction?: (id: string) => void;
  bottomInset: number;
  /** The manuscript is a screenplay: its drafts are marked script lines, shown set as a script. */
  screenplay?: boolean;
  /** Height of a floating header the thread scrolls underneath. */
  topInset?: number;
}) {
  const { t } = useTranslation();
  const { layout, colors, dark } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const composerRef = useRef<TextInput>(null);
  useEffect(() => {
    if (focusComposerKey > 0) composerRef.current?.focus();
  }, [focusComposerKey]);
  const canSend = Boolean(composer.trim()) && !streaming;
  const animate = !reduceMotion;
  // The tail of the stream is where new words land; everything above it is read.
  const liveAnimate = animate && streaming;

  /**
   * The dock rides the keyboard rather than the screen bottom. Closed, it
   * reserves room for the floating tab bar; open, that reserve would be a dead
   * gap over the keyboard, so the sticky offset gives it back.
   */
  const keyboardHeight = useKeyboardState((state) => (state.isVisible ? state.height : 0));
  const stickyOffset = Math.max(0, bottomInset - KEYBOARD_GAP);
  const hasSuggestions = Boolean(quickActions?.length && onQuickAction);
  // An empty chat starts with the chips out; either way the Suggestions button folds them.
  const chatEmpty = messages.length === 0;
  const [suggestionsOpen, setSuggestionsOpen] = useState(chatEmpty);
  const suggestionsIdle = !streaming && keyboardHeight === 0;
  const suggestionsShown = hasSuggestions && suggestionsIdle && suggestionsOpen;
  // An emptied chat lays them out again for the first message.
  useEffect(() => {
    if (chatEmpty) setSuggestionsOpen(true);
  }, [chatEmpty]);
  // Once it has begun, typing or a reply streaming in puts them away for the next time.
  useEffect(() => {
    if (!chatEmpty && (!suggestionsIdle || composer)) setSuggestionsOpen(false);
  }, [chatEmpty, suggestionsIdle, composer]);
  // What the raised dock hides that the resting one did not, so the last reply
  // stays reachable with the keyboard up.
  const keyboardLift = Math.max(0, keyboardHeight + KEYBOARD_GAP - bottomInset);

  const bannerShown = openQuestionCount > 0 && Boolean(onOpenQuestions);
  // The questions banner already clears the header, so the thread starts under it.
  const listTop = bannerShown ? 0 : topInset;
  const [listHeight, setListHeight] = useState(0);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [promptHeight, setPromptHeight] = useState(0);
  const [replyHeight, setReplyHeight] = useState(0);
  /**
   * Messages already in the transcript when it first has rows. Those skip the
   * enter animation — playing it on every bubble is most of the cost of
   * opening the tab. A prompt sent after that still fades in.
   */
  const historyIds = useRef<Set<string> | null>(null);
  if (messages.length === 0) {
    historyIds.current = null;
  } else if (historyIds.current === null) {
    historyIds.current = new Set(messages.map((message) => message.id));
  }

  const lastMessage = messages[messages.length - 1];
  const livePromptId =
    streaming && lastMessage?.role === "user" ? lastMessage.id : null;
  const activeAnchor = livePromptId ?? anchorId;

  /**
   * Newest first, so an inverted list rests - from its very first frame,
   * cache-seeded or not - with the tail already in view: no scroll-to-end,
   * no hiding the thread until a scroll lands, no guessing when a long
   * thread has finished mounting. A full-mount-then-scrollToEnd approach was
   * tried first (see git history), including an `initialScrollIndex` jump to
   * avoid mounting hundreds of rows, but both land wrong on-device with a
   * long thread: scroll offset estimation drifts over unmeasured rows, and
   * timer-based "has it settled" heuristics race real (slow, markdown-heavy)
   * batch rendering. An inverted list sidesteps the problem entirely -
   * natural windowing mounts only what is near the tail, which is already
   * the resting position, so there is nothing to scroll to.
   */
  const invertedMessages = useMemo(() => [...messages].reverse(), [messages]);

  useEffect(() => {
    if (messages.length === 0) {
      setAnchorId(null);
      setPromptHeight(0);
      setReplyHeight(0);
      return;
    }
    if (!livePromptId || livePromptId === anchorId) return;
    setAnchorId(livePromptId);
    setPromptHeight(0);
    setReplyHeight(0);
  }, [anchorId, livePromptId, messages.length]);

  // Sending a prompt while scrolled away from the tail should bring the
  // author back to it - they just started a new turn and want to watch the
  // reply land, same as any chat app does.
  const scrolledForPrompt = useRef<string | null>(null);
  /**
   * The prompt whose reply is streaming and still held at the top. The live
   * reply grows at offset 0, which would push the prompt up and off the
   * screen; while held, the native list keeps the prompt's row still in the
   * same frame the reply grows. Dragging the thread lets go of it, and so
   * does the reply settling into its own row.
   */
  const [heldPrompt, setHeldPrompt] = useState<string | null>(null);
  useEffect(() => {
    if (!livePromptId || scrolledForPrompt.current === livePromptId) return;
    scrolledForPrompt.current = livePromptId;
    setHeldPrompt(livePromptId);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [livePromptId]);

  // The keyboard used to drag the thread to its tail. Leave an anchored prompt
  // where the author is reading it; only follow the tail when nothing is pinned.
  // Offset 0 is the inverted list's own rest position - the tail - so this is
  // a return to rest, not a scroll to the end of the data.
  useEffect(() => {
    if (keyboardLift <= 0 || activeAnchor) return;
    const id = setTimeout(
      () => listRef.current?.scrollToOffset({ offset: 0, animated: !reduceMotion }),
      50
    );
    return () => clearTimeout(id);
  }, [activeAnchor, keyboardLift, reduceMotion]);

  // Clearing the conversation: the thread falls into the mark, the mark takes
  // the hit, and Undo stays within reach for a few seconds after.
  const [clearPhase, setClearPhase] = useState<ClearPhase>("idle");
  /**
   * How tall the floating dock is right now. The thread runs the full height of
   * the screen and scrolls underneath it, so the only thing keeping the last
   * reply reachable is matching padding at the end of the list — and the dock
   * grows with a multiline composer or a failure notice.
   */
  const [dockHeight, setDockHeight] = useState(0);
  const jumpOpacity = useSharedValue(0);
  const [jumpShown, setJumpShown] = useState(false);

  /**
   * Where the fade closes, in fractions of its own height. Gradient stops are
   * fractional but the thing being covered is not: the Clear chat label sits a
   * fixed distance down, and prose reading straight through it is the whole
   * failure being avoided. So the stops are derived from the measured dock
   * rather than guessed, and stay put as the composer grows.
   */
  const fadeStops = useMemo<readonly [number, number, number]>(() => {
    const height = FADE_LEAD + dockHeight;
    const at = (px: number) => Math.max(0, Math.min(1, px / height));
    // Solid from just above the label down through the composer.
    return [0, at(FADE_LEAD - 20), 1];
  }, [dockHeight]);
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
    haptics.impact("medium");
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
    endCeremony();
    onUndoClear(token);
  }, [endCeremony, onUndoClear, undoToken]);

  const syncJump = useCallback(
    (opacity: number) => {
      jumpOpacity.value = opacity;
      const shown = opacity > 0;
      setJumpShown((prev) => (prev === shown ? prev : shown));
    },
    [jumpOpacity]
  );

  const onThreadScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement } = event.nativeEvent;
      if (messages.length === 0) {
        syncJump(0);
        return;
      }
      // An inverted list rests at offset 0 at its own tail, so the offset
      // already is the distance scrolled away from it - no need to work that
      // back out from content size the way a non-inverted list would.
      syncJump(
        jumpChipOpacity(
          contentOffset.y,
          layoutMeasurement.height,
          CHAT_JUMP_START_SCREENS,
          reduceMotion ? 0 : CHAT_JUMP_FADE_SCREENS
        )
      );
    },
    [messages.length, reduceMotion, syncJump]
  );

  const jumpToLatest = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    syncJump(0);
  }, [syncJump]);

  useEffect(() => {
    if (messages.length === 0) syncJump(0);
  }, [messages.length, syncJump]);

  // A background refetch (another device, a stopped turn re-caching) that
  // prepends newer rows needs no scroll call: those rows land at the
  // inverted list's own start, which is exactly where offset 0 is already
  // resting if the author has not scrolled away. Scrolled away, they stay
  // put too - the jump chip is the invitation, not an auto-jump.

  // Opus 5.5's own progress note, when there's a fresh one, beats the
  // generic tool/phase labels - it says what Ciciro is actually doing.
  const latestProgress = stream.progress[stream.progress.length - 1];
  const toolLabel = latestProgress?.trim()
    ? latestProgress
    : stream.tools.length > 0
      ? t("ciciroTab.tools", { name: stream.tools[stream.tools.length - 1] })
      : phase
        ? t(`ciciroTab.phase.${phase}`)
        : t("ciciroTab.sending");

  const trailingPadding = dockHeight + keyboardLift + 16;
  const anchorIndex = activeAnchor
    ? messages.findIndex((message) => message.id === activeAnchor)
    : -1;
  const settledReply = anchorIndex >= 0 ? messages[anchorIndex + 1] : undefined;
  const showStream = streaming && !settledReply;
  const anchorGap = activeAnchor
    ? promptAnchorGap(listHeight - listTop, promptHeight, trailingPadding)
    : 0;
  const footerMin = activeAnchor
    ? anchorFooterMinHeight(anchorGap, showStream ? 0 : replyHeight)
    : 0;

  // Only once the gap below the prompt is measured: a gap that is still
  // settling would move the held row, and the list would follow it.
  const holdingPrompt =
    showStream &&
    activeAnchor != null &&
    heldPrompt === activeAnchor &&
    promptHeight > 0 &&
    anchorGap > 0;
  const releaseHold = useCallback(() => setHeldPrompt(null), []);

  const onPromptHeight = useCallback((height: number) => {
    setPromptHeight((current) => (current === height ? current : height));
  }, []);
  const onReplyHeight = useCallback((height: number) => {
    setReplyHeight((current) => (current === height ? current : height));
  }, []);
  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);
  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <ChatTurn
        message={item}
        anchored={item.id === activeAnchor}
        measureReply={settledReply?.id === item.id}
        enter={
          animate &&
          item.role === "user" &&
          item.id !== activeAnchor &&
          historyIds.current != null &&
          !historyIds.current.has(item.id)
        }
        inserted={insertedKeys}
        onInsertDraft={onInsertDraft}
        onRetry={onRetry}
        onPromptHeight={onPromptHeight}
        onReplyHeight={onReplyHeight}
        screenplay={screenplay}
      />
    ),
    [
      activeAnchor,
      animate,
      insertedKeys,
      onInsertDraft,
      onPromptHeight,
      onReplyHeight,
      onRetry,
      screenplay,
      settledReply?.id,
    ]
  );

  return (
    <View style={layout.screen}>
      {bannerShown ? (
        <Animated.View entering={animate ? FadeIn.duration(220) : undefined}>
          <TapPressable
            scale={PRESS_SCALE.card}
            accessibilityRole="button"
            accessibilityLabel={t("questions.banner", { count: openQuestionCount })}
            onPress={onOpenQuestions}
            style={[
              styles.banner,
              {
                marginTop: topInset + 8,
                borderColor: colors.line,
                backgroundColor: colors.accentSoft,
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
          </TapPressable>
        </Animated.View>
      ) : null}

      <View style={styles.thread}>
      {showsThread(clearPhase) ? (
      <ThreadFade collapse={collapse}>
      <FlatList
        testID="chat-thread"
        ref={listRef}
        inverted
        style={{ flex: 1 }}
        data={invertedMessages}
        // Inverted flips the content container's own top/bottom, so the
        // padding that visually clears the banner at the top of the screen
        // is written here as bottom, and the padding that clears the dock at
        // the bottom is written as top.
        contentContainerStyle={[
          styles.list,
          { paddingBottom: listTop + 8, paddingTop: trailingPadding },
        ]}
        scrollIndicatorInsets={{ bottom: listTop }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          setListHeight((current) => (current === height ? current : height));
        }}
        onScroll={onThreadScroll}
        scrollEventThrottle={16}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        // The resting position (offset 0) is already the tail, so only a
        // couple of screens near it need to be there on the first frame;
        // normal windowing takes it from there as the author scrolls up.
        initialNumToRender={16}
        maxToRenderPerBatch={4}
        windowSize={7}
        updateCellsBatchingPeriod={50}
        onScrollBeginDrag={releaseHold}
        maintainVisibleContentPosition={holdingPrompt ? HOLD_PROMPT_ROW : undefined}
        ListEmptyComponent={
          streaming ? null : <ChatEmptyState colors={colors} />
        }
        // The chronologically newest content - the anchored prompt's footer
        // spacer and the live/settled reply - sits at the data array's own
        // start once reversed for `inverted`, which renders as the header,
        // not the footer. VirtualizedList already counter-flips the header
        // and empty components upright.
        ListHeaderComponent={
          showStream || footerMin > 0 ? (
            <View
              testID={activeAnchor ? "chat-anchor" : undefined}
              style={footerMin > 0 ? { minHeight: footerMin } : undefined}
              collapsable={false}
            >
              {showStream ? (
                <View
                  style={styles.assistant}
                  onLayout={(event) => {
                    const height = event.nativeEvent.layout.height;
                    setReplyHeight((current) => (current === height ? current : height));
                  }}
                >
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
                      screenplay={screenplay}
                    />
                  ) : (
                    <CiciroThinking colors={colors} label={toolLabel} reduceMotion={reduceMotion} />
                  )}
                </View>
              ) : null}
            </View>
          ) : null
        }
      />
      </ThreadFade>
      ) : null}
      {showsMark(clearPhase) ? (
        <ChatClearMark colors={colors} hopSignal={hopSignal} reduceMotion={reduceMotion} />
      ) : null}
      </View>

      {/*
        The dock floats over the thread rather than walling it off, so the
        conversation scrolls on underneath it instead of stopping at a hard
        edge. box-none lets a tap through wherever the dock is only gradient.
        The fade dissolves prose in the lead above the dock and is solid by
        the Clear chat label, so nothing reads through the dock's chrome.
      */}
      <KeyboardStickyView
        testID="chat-dock"
        offset={{ closed: 0, opened: stickyOffset }}
        pointerEvents="box-none"
        style={styles.dockWrap}
        onLayout={(event) => setDockHeight(event.nativeEvent.layout.height)}
      >
        <LinearGradient
          pointerEvents="none"
          colors={[
            alpha(colors.bg, 0),
            alpha(colors.bg, 1),
            alpha(colors.bg, 1),
          ]}
          locations={fadeStops}
          style={styles.dockFade}
        />

        {insertError ? (
          <AlertText style={[layout.error, { marginHorizontal: 20 }]} role="alert">
            {insertError}
          </AlertText>
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

        <View style={[styles.dock, { paddingBottom: bottomInset }]}>
          {/*
            Its own frosted chip rather than bare text. The thread scrolls live
            underneath this whole dock, and a plain label would have prose
            running straight through it.
          */}
          {quickActions && onQuickAction ? (
            <SuggestionChips open={suggestionsShown} reduceMotion={reduceMotion}>
              {quickActions.map((action) => (
                <Glass key={action.id} dark={dark} colors={colors} radius={16} flat>
                  <TapPressable
                    scale={PRESS_SCALE.chip}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                    onPress={() => {
                      setSuggestionsOpen(false);
                      onQuickAction(action.id);
                    }}
                    style={styles.actionChip}
                  >
                    <Text style={{ color: colors.ink, fontSize: 13.5, fontWeight: "500" }}>{action.label}</Text>
                  </TapPressable>
                </Glass>
              ))}
            </SuggestionChips>
          ) : null}
          <View style={styles.chromeRow}>
            <Glass
              dark={dark}
              colors={colors}
              radius={14}
              style={{ opacity: messages.length === 0 ? 0.45 : 1 }}
            >
              <TapPressable
                feedback="dim"
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
                <Text style={{ color: colors.inkSoft, fontSize: 13 }}>
                  {t("ciciroTab.clear")}
                </Text>
              </TapPressable>
            </Glass>
            {onEditModeChange ? (
              <EditModeToggle mode={editMode} onChange={onEditModeChange} />
            ) : null}
            {hasSuggestions && suggestionsIdle ? (
              <Glass dark={dark} colors={colors} radius={14}>
                <TapPressable
                  feedback="dim"
                  haptic="none"
                  accessibilityRole="button"
                  accessibilityState={{ expanded: suggestionsOpen }}
                  accessibilityLabel={t("ciciroTab.suggestions")}
                  onPress={() => {
                    // A firmer bump unfolding the chips, a lighter one folding them away.
                    haptics.impact(suggestionsOpen ? "light" : "medium");
                    setSuggestionsOpen(!suggestionsOpen);
                  }}
                  hitSlop={7}
                  style={styles.suggest}
                >
                  <SparkleIcon color={suggestionsOpen ? colors.accent : colors.inkSoft} size={16} />
                </TapPressable>
              </Glass>
            ) : null}
            {jumpShown && showsThread(clearPhase) ? (
              <JumpChip opacity={jumpOpacity}>
                <Glass dark={dark} colors={colors} radius={14}>
                  <TapPressable
                    scale={PRESS_SCALE.fab}
                    accessibilityRole="button"
                    accessibilityLabel={t("ciciroTab.scrollToLatest")}
                    onPress={jumpToLatest}
                    style={styles.jump}
                  >
                    <ArrowDownIcon color={colors.inkSoft} size={16} />
                  </TapPressable>
                </Glass>
              </JumpChip>
            ) : null}
          </View>
          <Glass dark={dark} colors={colors} radius={24} style={styles.bubble}>
            <View testID="chat-composer" style={styles.composer}>
              <TextInput
                ref={composerRef}
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
      </KeyboardStickyView>
    </View>
  );
}

const styles = StyleSheet.create({
  thread: { flex: 1 },
  threadFill: { flex: 1 },
  list: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  // Inverted, the layout top is the side facing the dock: clear the whole fade
  // so the hint is not washed out where the starter chips used to sit.
  emptyState: { alignItems: "center", marginTop: FADE_LEAD, gap: 14 },
  emptyText: { fontSize: 15, lineHeight: 22, textAlign: "center" },
  // A scroll view clips its content, and each chip's glass casts a soft shadow
  // below it: the padding gives the shadow room and the negative margin takes
  // that room back out of the layout.
  // The chips are flat glass: a scroll view clips a drop shadow at its edges,
  // which reads as a box ending wherever the row stops. The frame's height runs
  // from nothing (folded) to the row plus its gap above the Clear chat row.
  actionsFrame: { marginHorizontal: -16 },
  actionsScroll: { position: "absolute", left: 0, right: 0, bottom: 0, flexGrow: 0 },
  actionsRow: { gap: 8, paddingHorizontal: 16, paddingBottom: CHIP_ROW_GAP },
  actionChip: { paddingHorizontal: 13, paddingVertical: 8 },
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
  dockWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  /**
   * The fade reaches well above the dock it belongs to. A ramp confined to the
   * dock would be a visible edge; starting it early gives prose room to dissolve
   * on its way under the composer instead of being cut off by it.
   */
  dockFade: { position: "absolute", top: -FADE_LEAD, left: 0, right: 0, bottom: 0 },
  dock: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    marginBottom: 10,
    marginLeft: 4,
  },
  clear: { paddingHorizontal: 13, paddingVertical: 7 },
  jump: { paddingHorizontal: 10, paddingVertical: 7 },
  suggest: { paddingHorizontal: 10, paddingVertical: 7 },
  bubble: {
    minHeight: 52,
  },
  composer: {
    flexDirection: "row",
    alignItems: "center",
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
    justifyContent: "center",
    alignItems: "center",
  },
  send: {
    width: SEND_SIZE,
    height: SEND_SIZE,
    borderRadius: SEND_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
