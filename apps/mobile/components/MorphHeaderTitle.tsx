import { useCallback, useEffect, useRef, type RefObject } from "react";
import Animated, { FadeIn } from "react-native-reanimated";
import { StyleSheet, type NativeMethods, type Text, type View } from "react-native";
import { useNavigation } from "expo-router";
import { ownsStackRemove, shouldInterceptStackRemove } from "../lib/stack-pop";
import { useStackArrival } from "../lib/stack-arrival";
import { useSetScreenOverlay } from "../lib/screen-overlay";
import {
  SharedTitleMorphOverlay,
  useMorphHidden,
  useSharedTitleMorph,
  useSharedTitleMorphState,
  type MorphTitleStyle,
} from "../lib/shared-title-morph";
import { useReduceMotion } from "../lib/use-reduce-motion";

/**
 * `AppHeader`'s title when it is the landing spot of a shared-title morph
 * (see `shared-title-morph.tsx`). Measures itself relative to `rootRef`
 * (`AppHeader`'s own root view, which this title's ancestors never transform -
 * see `measureLayout`'s ancestor-relative, transform-free semantics) so the
 * frame is correct even while the screen it is on is mid push or pop.
 */
export function MorphHeaderTitle({
  morphKey,
  text,
  style,
  rootRef,
}: {
  morphKey: string;
  text: string;
  style: MorphTitleStyle;
  rootRef: RefObject<(View & NativeMethods) | null>;
}) {
  const ref = useRef<Text & NativeMethods>(null);
  const navigation = useNavigation();
  const morph = useSharedTitleMorph();
  const morphState = useSharedTitleMorphState();
  const reduceMotion = useReduceMotion();
  const setOverlay = useSetScreenOverlay();
  const hidden = useMorphHidden(reduceMotion ? null : morphKey);

  const measureFrame = useCallback(() => {
    if (!morph || reduceMotion) return;
    const node = ref.current;
    const root = rootRef.current;
    if (!node?.measureLayout || !root) return;
    node.measureLayout(
      root,
      (x: number, y: number, width: number, height: number) => {
        morph.registerDestination(morphKey, { text, style, frame: { x, y, width, height } });
      },
      () => {}
    );
  }, [morph, reduceMotion, rootRef, morphKey, text, style]);

  useStackArrival(
    useCallback(() => {
      if (!morph || reduceMotion) return;
      morph.notifyArrived(morphKey);
    }, [morph, reduceMotion, morphKey])
  );

  useEffect(() => {
    if (!morph || reduceMotion) return;
    // A header nested below extra navigators (the manuscript's tabs, for one)
    // only ever hears `beforeRemove` for removals those own - never the root
    // stack popping the whole screen out from under them (see `ownsStackRemove`
    // in `stack-pop.ts`). `StackPopTransition` sidesteps this by having an
    // instance at every nesting level, each checking only its own level; this
    // single header does the same by listening on every ancestor up to the
    // root and letting each one's own `ownsStackRemove` check decide.
    const ancestors: typeof navigation[] = [];
    for (let nav: typeof navigation | undefined = navigation; nav; nav = nav.getParent()) {
      ancestors.push(nav);
    }
    const unsubs = ancestors.map((nav) =>
      nav.addListener("beforeRemove", (event) => {
        if (!shouldInterceptStackRemove(event.data.action.type)) return;
        if (!ownsStackRemove(event.data.action, nav.getState())) return;
        morph.beginBackward(morphKey);
      })
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, [morph, navigation, morphKey, reduceMotion]);

  // Paints the travelling title into this screen's untransformed overlay slot
  // for exactly as long as this title's own real text is hidden for it - i.e.
  // while this morph is actually in flight, not once it has landed.
  useEffect(() => {
    if (!morph || !hidden) {
      setOverlay(null);
      return;
    }
    setOverlay(
      <SharedTitleMorphOverlay state={morphState} progress={morph.progress} onShown={morph.markOverlayShown} />
    );
    return () => setOverlay(null);
  }, [morph, hidden, morphState, setOverlay]);

  return (
    <Animated.Text
      ref={ref}
      key={text}
      onLayout={measureFrame}
      entering={reduceMotion ? undefined : FadeIn.duration(180)}
      numberOfLines={1}
      accessibilityRole="header"
      style={[
        { color: style.color, fontFamily: style.fontFamily, fontSize: style.fontSize, letterSpacing: style.letterSpacing },
        styles.title,
        hidden ? styles.hidden : null,
      ]}
    >
      {text}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  title: { flex: 1 },
  hidden: { opacity: 0 },
});
