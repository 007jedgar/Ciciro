import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

/**
 * A forward morph whose destination has not registered and arrived by now is
 * abandoned (the push was redirected, or the header never measured), so the
 * row's title is never left hidden behind a morph that will not play.
 */
const FORWARD_STALL_MS = 2000;

/** Stable for the provider's lifetime, so a list holding it never re-renders as a morph advances. */
type MorphActions = {
  progress: SharedValue<number>;
  /** The in-flight morph's key, on the UI thread, so a row hides in the same frame the overlay first moves. */
  flightKey: SharedValue<string | null>;
  registerSource: (key: string, record: SourceRecord) => () => void;
  beginForward: (key: string) => Promise<void>;
  registerDestination: (key: string, info: { text: string; style: MorphTitleStyle; frame: MorphFrame }) => void;
  notifyArrived: (key: string) => void;
  beginBackward: (key: string) => void;
};

const SharedTitleMorphContext = createContext<MorphActions | null>(null);
const SharedTitleMorphStateContext = createContext<MorphState>(IDLE_STATE);

export function useSharedTitleMorph(): MorphActions | null {
  return useContext(SharedTitleMorphContext);
}

export function useSharedTitleMorphState(): MorphState {
  return useContext(SharedTitleMorphStateContext);
}

function inFlight(state: MorphState, key: string | null): boolean {
  return key !== null && state.key === key && (state.phase === "to-dest" || state.phase === "to-source");
}

/** Whether the destination header's own text should hide because an in-flight morph is standing in for it. */
export function useMorphHidden(key: string | null): boolean {
  return inFlight(useSharedTitleMorphState(), key);
}

/**
 * A row's own text style: hidden while the travelling title is off its
 * starting spot. Decided on the UI thread from the same `progress` that shows
 * the overlay (see `SharedTitleMorphOverlay`), so the two swap in one frame
 * and the row is never blank with nothing painted over it.
 */
export function useMorphSourceStyle(key: string | null) {
  const morph = useSharedTitleMorph();
  const progress = morph?.progress;
  const flightKey = morph?.flightKey;
  return useAnimatedStyle(() => {
    "worklet";
    const hidden = key !== null && flightKey?.value === key && (progress?.value ?? 0) > 0;
    return { opacity: hidden ? 0 : 1 };
  }, [key, progress, flightKey]);
}

export function SharedTitleMorphProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MorphState>(IDLE_STATE);
  const progress = useSharedValue(0);
  const flightKey = useSharedValue<string | null>(null);

  const sourceRegistry = useRef(new Map<string, SourceRecord>()).current;
  // Control-flow guards live in refs, not state: they gate *when* an animation
  // starts, which must not itself depend on a render having happened yet.
  const activeKeyRef = useRef<string | null>(null);
  const destFrameRef = useRef<{ text: string; style: MorphTitleStyle; frame: MorphFrame } | null>(null);
  const arrivedRef = useRef(false);
  const forwardStartedRef = useRef<string | null>(null);
  const backwardStartedRef = useRef<string | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    stallTimerRef.current = null;
  }, []);

  useEffect(() => clearStallTimer, [clearStallTimer]);

  const finishForward = useCallback((key: string) => {
    if (flightKey.value === key) flightKey.value = null;
    setState((prev) => (prev.key === key && prev.phase === "to-dest" ? { ...prev, phase: "at-dest" } : prev));
  }, [flightKey]);

  const finishBackward = useCallback((key: string) => {
    activeKeyRef.current = null;
    backwardStartedRef.current = null;
    if (flightKey.value === key) flightKey.value = null;
    setState((prev) => (prev.key === key ? IDLE_STATE : prev));
  }, [flightKey]);

  const abandonForward = useCallback(
    (key: string) => {
      stallTimerRef.current = null;
      if (activeKeyRef.current !== key || forwardStartedRef.current === key) return;
      activeKeyRef.current = null;
      destFrameRef.current = null;
      cancelAnimation(progress);
      progress.value = 0;
      flightKey.value = null;
      setState((prev) => (prev.key === key ? IDLE_STATE : prev));
    },
    [progress, flightKey]
  );

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
      clearStallTimer();
      tryStartForward(key);
    },
    [tryStartForward, clearStallTimer]
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
      flightKey.value = key;
      clearStallTimer();
      stallTimerRef.current = setTimeout(() => abandonForward(key), FORWARD_STALL_MS);
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
    [progress, flightKey, clearStallTimer, abandonForward]
  );

  const registerDestination = useCallback(
    (key: string, info: { text: string; style: MorphTitleStyle; frame: MorphFrame }) => {
      if (activeKeyRef.current !== key) return;
      destFrameRef.current = info;
      // The travelling title keeps the row's text: the header can register
      // before its own data has loaded (a placeholder such as "Untitled").
      setState((prev) =>
        prev.key === key && (prev.phase === "to-dest" || prev.phase === "at-dest")
          ? { ...prev, destStyle: info.style, dest: info.frame }
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
      clearStallTimer();
      flightKey.value = key;
      setState((prev) => (prev.key === key ? { ...prev, phase: "to-source" } : prev));
      cancelAnimation(progress);
      progress.value = withTiming(0, { duration: STACK_POP_MS, easing: EASE_OUT }, (finished) => {
        if (finished) runOnJS(finishBackward)(key);
      });
    },
    [progress, flightKey, finishBackward, clearStallTimer]
  );

  const actions = useMemo<MorphActions>(
    () => ({
      progress,
      flightKey,
      registerSource,
      beginForward,
      registerDestination,
      notifyArrived,
      beginBackward,
    }),
    [progress, flightKey, registerSource, beginForward, registerDestination, notifyArrived, beginBackward]
  );

  return (
    <SharedTitleMorphContext.Provider value={actions}>
      <SharedTitleMorphStateContext.Provider value={state}>{children}</SharedTitleMorphStateContext.Provider>
    </SharedTitleMorphContext.Provider>
  );
}

/**
 * The travelling title, rendered inside the destination screen's
 * untransformed overlay slot (see `screen-overlay.ts`) so it paints above
 * both screens without inheriting the destination's own push/pop transform.
 *
 * Two stacked, crossfading `Text`s avoid a hard font-family swap: the source
 * font fades out while the destination font fades in. Each layer is laid out
 * once, at its own end's width and font size (so the row's layer wraps exactly
 * like the row, and the header's like the header), and only scaled and faded
 * as the clipping frame moves: animating `fontSize` or a text container's
 * width instead lets the drawn text drift from its laid-out lines.
 *
 * The overlay shows only while `progress` is off 0, the row's own spot, in
 * the same UI-thread frame the row hides (`useMorphSourceStyle`).
 */
export function SharedTitleMorphOverlay({ state, progress }: { state: MorphState; progress: SharedValue<number> }) {
  const source = state.source;
  const dest = state.dest ?? state.source;
  const sourceStyle = state.sourceStyle;
  const destStyle = state.destStyle ?? state.sourceStyle;

  const frameStyle = useAnimatedStyle(() => {
    "worklet";
    if (!source || !dest) return { opacity: 0 };
    const p = progress.value;
    return {
      opacity: p > 0 ? 1 : 0,
      left: interpolate(p, [0, 1], [source.x, dest.x]),
      top: interpolate(p, [0, 1], [source.y, dest.y]),
      width: interpolate(p, [0, 1], [source.width, dest.width]),
      height: interpolate(p, [0, 1], [source.height, dest.height]),
    };
  }, [source, dest]);

  const sourceLayer = useAnimatedStyle(() => {
    "worklet";
    if (!sourceStyle || !destStyle) return {};
    const p = progress.value;
    const fontSize = interpolate(p, [0, 1], [sourceStyle.fontSize, destStyle.fontSize]);
    return { opacity: 1 - p, transform: [{ scale: fontSize / sourceStyle.fontSize }] };
  }, [sourceStyle, destStyle]);

  const destLayer = useAnimatedStyle(() => {
    "worklet";
    if (!sourceStyle || !destStyle) return {};
    const p = progress.value;
    const fontSize = interpolate(p, [0, 1], [sourceStyle.fontSize, destStyle.fontSize]);
    return { opacity: p, transform: [{ scale: fontSize / destStyle.fontSize }] };
  }, [sourceStyle, destStyle]);

  if (!source || !sourceStyle || !dest || !destStyle) return null;

  // The frame this morph starts from, as plain style: the animated styles can
  // land a frame after the overlay mounts.
  const atDest = state.phase === "to-source";
  const startFrame = atDest ? dest : source;

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          overflow: "hidden",
          opacity: atDest ? 1 : 0,
          left: startFrame.x,
          top: startFrame.y,
          width: startFrame.width,
          height: startFrame.height,
        },
        frameStyle,
      ]}
    >
      <Animated.Text
        style={[
          styles.layer,
          {
            width: source.width,
            color: sourceStyle.color,
            fontFamily: sourceStyle.fontFamily,
            fontSize: sourceStyle.fontSize,
            letterSpacing: sourceStyle.letterSpacing,
            opacity: atDest ? 0 : 1,
          },
          sourceLayer,
        ]}
      >
        {state.text}
      </Animated.Text>
      <Animated.Text
        numberOfLines={1}
        style={[
          styles.layer,
          {
            width: dest.width,
            color: destStyle.color,
            fontFamily: destStyle.fontFamily,
            fontSize: destStyle.fontSize,
            letterSpacing: destStyle.letterSpacing,
            opacity: atDest ? 1 : 0,
          },
          destLayer,
        ]}
      >
        {state.text}
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", left: 0, top: 0, transformOrigin: "left top" },
});
