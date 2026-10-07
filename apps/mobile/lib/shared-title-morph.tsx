import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { StyleSheet } from "react-native";
import Animated, {
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { EASE_OUT, EASE_PUSH } from "./motion";
import { STACK_POP_MS, STACK_PUSH_MS } from "./stack-pop";

/**
 * A shared-title morph: a row's title on a list screen slides, grows and
 * changes font into a pushed screen's header title (and the reverse on the
 * way back). `sharedTransitionTag`-style native shared elements do not work
 * under this app's transparent-modal push (see `StackPopTransition`), so this
 * is built from measured source/destination frames and a crossfading overlay
 * instead - see `AGENTS.md`'s "Mobile motion" section.
 *
 * Only one morph is ever in flight at a time (you cannot be mid-push on two
 * rows at once), so a single global channel - not one per row - is enough.
 */

/** The two morphs this app wires up today; keeps the row and its destination header in sync on the same key. */
export function folderMorphKey(folderId: string): string {
  return `folder:${folderId}`;
}
export function manuscriptMorphKey(projectId: string): string {
  return `manuscript:${projectId}`;
}

export type MorphFrame = { x: number; y: number; width: number; height: number };

export type MorphTitleStyle = {
  color: string;
  fontFamily?: string;
  fontSize: number;
  letterSpacing?: number;
};

type SourceRecord = {
  text: string;
  style: MorphTitleStyle;
  measure: () => Promise<MorphFrame | null>;
};

type Phase = "idle" | "to-dest" | "at-dest" | "to-source";

type MorphState = {
  key: string | null;
  phase: Phase;
  text: string;
  sourceStyle: MorphTitleStyle | null;
  destStyle: MorphTitleStyle | null;
  source: MorphFrame | null;
  dest: MorphFrame | null;
};

const IDLE_STATE: MorphState = {
  key: null,
  phase: "idle",
  text: "",
  sourceStyle: null,
  destStyle: null,
  source: null,
  dest: null,
};

type MorphContextValue = {
  state: MorphState;
  progress: SharedValue<number>;
  registerSource: (key: string, record: SourceRecord) => () => void;
  beginForward: (key: string) => Promise<void>;
  registerDestination: (key: string, info: { text: string; style: MorphTitleStyle; frame: MorphFrame }) => void;
  notifyArrived: (key: string) => void;
  beginBackward: (key: string) => void;
};

const SharedTitleMorphContext = createContext<MorphContextValue | null>(null);

export function useSharedTitleMorph(): MorphContextValue | null {
  return useContext(SharedTitleMorphContext);
}

/** Whether this key's own text should hide because an in-flight morph is standing in for it. */
export function useMorphHidden(key: string | null): boolean {
  const morph = useSharedTitleMorph();
  if (!morph || !key) return false;
  return morph.state.key === key && (morph.state.phase === "to-dest" || morph.state.phase === "to-source");
}

export function SharedTitleMorphProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MorphState>(IDLE_STATE);
  const progress = useSharedValue(0);

  const sourceRegistry = useRef(new Map<string, SourceRecord>()).current;
  // Control-flow guards live in refs, not state: they gate *when* an animation
  // starts, which must not itself depend on a render having happened yet.
  const activeKeyRef = useRef<string | null>(null);
  const destFrameRef = useRef<{ text: string; style: MorphTitleStyle; frame: MorphFrame } | null>(null);
  const arrivedRef = useRef(false);
  const forwardStartedRef = useRef<string | null>(null);
  const backwardStartedRef = useRef<string | null>(null);

  const finishForward = useCallback((key: string) => {
    setState((prev) => (prev.key === key && prev.phase === "to-dest" ? { ...prev, phase: "at-dest" } : prev));
  }, []);

  const finishBackward = useCallback((key: string) => {
    activeKeyRef.current = null;
    backwardStartedRef.current = null;
    setState((prev) => (prev.key === key ? IDLE_STATE : prev));
  }, []);

  const tryStartForward = useCallback(
    (key: string) => {
      cancelAnimation(progress);
      progress.value = withTiming(1, { duration: STACK_PUSH_MS, easing: EASE_PUSH }, (finished) => {
        if (finished) runOnJS(finishForward)(key);
      });
    },
    [progress, finishForward]
  );

  const maybeStartForward = useCallback(
    (key: string) => {
      if (activeKeyRef.current !== key) return;
      if (forwardStartedRef.current === key) return;
      if (!destFrameRef.current || !arrivedRef.current) return;
      forwardStartedRef.current = key;
      tryStartForward(key);
    },
    [tryStartForward]
  );

  const registerSource = useCallback((key: string, record: SourceRecord) => {
    sourceRegistry.set(key, record);
    return () => {
      if (sourceRegistry.get(key) === record) sourceRegistry.delete(key);
    };
  }, []);

  const beginForward = useCallback(
    async (key: string) => {
      const record = sourceRegistry.get(key);
      if (!record) return;
      const frame = await record.measure();
      if (!frame) return;
      activeKeyRef.current = key;
      destFrameRef.current = null;
      arrivedRef.current = false;
      forwardStartedRef.current = null;
      backwardStartedRef.current = null;
      cancelAnimation(progress);
      progress.value = 0;
      setState({
        key,
        phase: "to-dest",
        text: record.text,
        sourceStyle: record.style,
        destStyle: null,
        source: frame,
        dest: null,
      });
    },
    [progress]
  );

  const registerDestination = useCallback(
    (key: string, info: { text: string; style: MorphTitleStyle; frame: MorphFrame }) => {
      if (activeKeyRef.current !== key) return;
      destFrameRef.current = info;
      setState((prev) =>
        prev.key === key && (prev.phase === "to-dest" || prev.phase === "at-dest")
          ? { ...prev, text: info.text, destStyle: info.style, dest: info.frame }
          : prev
      );
      maybeStartForward(key);
    },
    [maybeStartForward]
  );

  const notifyArrived = useCallback(
    (key: string) => {
      if (activeKeyRef.current !== key) return;
      arrivedRef.current = true;
      maybeStartForward(key);
    },
    [maybeStartForward]
  );

  const beginBackward = useCallback(
    (key: string) => {
      if (activeKeyRef.current !== key) return;
      if (backwardStartedRef.current === key) return;
      backwardStartedRef.current = key;
      setState((prev) => (prev.key === key ? { ...prev, phase: "to-source" } : prev));
      cancelAnimation(progress);
      progress.value = withTiming(0, { duration: STACK_POP_MS, easing: EASE_OUT }, (finished) => {
        if (finished) runOnJS(finishBackward)(key);
      });
    },
    [progress, finishBackward]
  );

  const value = useMemo<MorphContextValue>(
    () => ({ state, progress, registerSource, beginForward, registerDestination, notifyArrived, beginBackward }),
    [state, progress, registerSource, beginForward, registerDestination, notifyArrived, beginBackward]
  );

  return <SharedTitleMorphContext.Provider value={value}>{children}</SharedTitleMorphContext.Provider>;
}

/**
 * The travelling title, rendered inside the destination screen's
 * untransformed overlay slot (see `screen-overlay.ts`) so it paints above
 * both screens without inheriting the destination's own push/pop transform.
 *
 * Two stacked, crossfading `Text`s avoid a hard font-family swap: the source
 * font fades out while the destination font fades in, both sharing the same
 * interpolated position, width and size so neither pops.
 */
export function SharedTitleMorphOverlay({
  state,
  progress,
}: {
  state: MorphState;
  progress: SharedValue<number>;
}) {
  const source = state.source;
  const dest = state.dest ?? state.source;
  const sourceStyle = state.sourceStyle;
  const destStyle = state.destStyle ?? state.sourceStyle;

  const frameStyle = useAnimatedStyle(() => {
    "worklet";
    if (!source || !dest) return { opacity: 0 };
    const p = progress.value;
    return {
      position: "absolute",
      overflow: "hidden",
      left: interpolate(p, [0, 1], [source.x, dest.x]),
      top: interpolate(p, [0, 1], [source.y, dest.y]),
      width: interpolate(p, [0, 1], [source.width, dest.width]),
      height: interpolate(p, [0, 1], [source.height, dest.height]),
    };
  }, [source, dest]);

  const fontStyle = useAnimatedStyle(() => {
    "worklet";
    if (!sourceStyle || !destStyle) return {};
    const p = progress.value;
    return {
      fontSize: interpolate(p, [0, 1], [sourceStyle.fontSize, destStyle.fontSize]),
      letterSpacing: interpolate(p, [0, 1], [sourceStyle.letterSpacing ?? 0, destStyle.letterSpacing ?? 0]),
    };
  }, [sourceStyle, destStyle]);

  const sourceOpacity = useAnimatedStyle(() => {
    "worklet";
    return { opacity: 1 - progress.value };
  });
  const destOpacity = useAnimatedStyle(() => {
    "worklet";
    return { opacity: progress.value };
  });

  if (!source || !sourceStyle) return null;

  return (
    <Animated.View style={frameStyle}>
      {/* Unlike the header (always one line), a row's title wraps - numberOfLines
          here would leave it a single sliver inside its own, much taller, measured
          frame for most of the animation. Clipping (`overflow: "hidden"` above) does
          the job of keeping it inside the interpolated box instead. */}
      <Animated.Text
        style={[
          { color: sourceStyle.color, fontFamily: sourceStyle.fontFamily },
          fontStyle,
          sourceOpacity,
        ]}
      >
        {state.text}
      </Animated.Text>
      {destStyle ? (
        <Animated.Text
          numberOfLines={1}
          style={[
            StyleSheet.absoluteFill,
            { color: destStyle.color, fontFamily: destStyle.fontFamily },
            fontStyle,
            destOpacity,
          ]}
        >
          {state.text}
        </Animated.Text>
      ) : null}
    </Animated.View>
  );
}
