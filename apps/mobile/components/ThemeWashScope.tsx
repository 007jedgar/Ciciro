import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import {
  Canvas,
  Group,
  Image as SkiaImage,
  Skia,
  makeImageFromView,
  type SkImage,
} from "@shopify/react-native-skia";
import Animated, { Easing, runOnJS, useDerivedValue, useSharedValue, withTiming } from "react-native-reanimated";
import {
  applyThemeWash,
  finishThemeWash,
  getThemeWash,
  subscribeThemeWash,
  WASH_REPAINT_MS,
  WASH_REVEAL_MS,
  type ThemeWash,
} from "../lib/theme-wash";

/** Innermost scope last: a modal-presented screen's scope sits above the root's, and is the one on screen. */
const scopes: number[] = [];
let nextScope = 1;

/**
 * Wraps a full-screen view so a theme change can wash across it. The wash takes
 * a snapshot of the screen as it is, swaps the theme underneath, then opens a
 * circle from the tap that cuts the snapshot away to show the real screen,
 * already painted in the new theme. Nothing blanks and no flat colour fills the
 * screen: the circle's edge is just where the old look ends and the new begins.
 *
 * Mount one at the root, and one inside any screen presented as a modal (those
 * sit above the root, so the root's snapshot would be hidden behind them).
 */
export function ThemeWashScope({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const ref = useRef<View>(null);
  const id = useRef(nextScope++).current;
  const wash = useSyncExternalStore(subscribeThemeWash, getThemeWash, getThemeWash);
  const [reveal, setReveal] = useState<{ wash: ThemeWash; image: SkImage } | null>(null);
  const handled = useRef(0);
  // The wash this scope has taken on and not yet finished.
  const inFlight = useRef(0);

  useEffect(() => {
    scopes.push(id);
    return () => {
      const at = scopes.indexOf(id);
      if (at >= 0) scopes.splice(at, 1);
    };
  }, [id]);

  // Unmounting mid-wash (Settings dismissed with Android back) must not lose the
  // theme the person tapped: swap it, then free the next tap.
  useEffect(
    () => () => {
      if (!inFlight.current) return;
      applyThemeWash(inFlight.current);
      finishThemeWash(inFlight.current);
    },
    []
  );

  useEffect(() => {
    if (!wash || handled.current === wash.id || scopes[scopes.length - 1] !== id) return;
    handled.current = wash.id;
    inFlight.current = wash.id;
    const skip = () => {
      // No snapshot to reveal from: swap the theme, no animation.
      inFlight.current = 0;
      applyThemeWash(wash.id);
      finishThemeWash(wash.id);
    };
    makeImageFromView(ref).then(
      (image) => (image ? setReveal({ wash, image }) : skip()),
      skip
    );
  }, [wash, id]);

  return (
    <View ref={ref} collapsable={false} style={style}>
      {children}
      {reveal ? (
        <WashReveal
          wash={reveal.wash}
          image={reveal.image}
          onDone={() => {
            inFlight.current = 0;
            setReveal(null);
            finishThemeWash(reveal.wash.id);
          }}
        />
      ) : null}
    </View>
  );
}

function WashReveal({ wash, image, onDone }: { wash: ThemeWash; image: SkImage; onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const radius = useSharedValue(0);
  const cx = wash.x;
  const cy = wash.y;
  // Far enough that the circle clears the corner furthest from the tap.
  const reach =
    Math.max(Math.hypot(cx, cy), Math.hypot(width - cx, cy), Math.hypot(cx, height - cy), Math.hypot(width - cx, height - cy)) + 2;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The snapshot is already on screen, identical to the screen it covers, so
    // swap the theme under it, give React a beat to paint it, then open the circle.
    const frame = requestAnimationFrame(() => {
      applyThemeWash(wash.id);
      timer = setTimeout(() => {
        radius.value = withTiming(reach, { duration: WASH_REVEAL_MS, easing: Easing.out(Easing.cubic) }, (finished) => {
          if (finished) runOnJS(onDone)();
        });
      }, WASH_REPAINT_MS);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      // Torn down before the circle finished: the theme still has to change.
      applyThemeWash(wash.id);
      finishThemeWash(wash.id);
    };
    // One wash, one run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Everything outside the growing circle is the old screen; inside it, the new one shows through.
  const hole = useDerivedValue(() => {
    const path = Skia.Path.Make();
    path.addCircle(cx, cy, radius.value);
    return path;
  });

  return (
    <Animated.View pointerEvents="auto" style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Group clip={hole} invertClip>
          <SkiaImage image={image} x={0} y={0} width={width} height={height} fit="fill" />
        </Group>
      </Canvas>
    </Animated.View>
  );
}
