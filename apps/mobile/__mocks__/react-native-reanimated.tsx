/**
 * Reanimated, for tests.
 *
 * The package's own mock re-enters the real entry point, which boots the
 * worklets native module and throws under Jest. This stands in for the surface
 * the app actually uses: plain components, shared values as ordinary boxes, and
 * animation builders that resolve to their final value immediately. Tests can
 * then assert on what a screen says rather than on how it got there.
 */
import { forwardRef, type ComponentType } from "react";
import { Image, ScrollView, Text, View } from "react-native";

type Entering = Record<string, unknown>;

/** Every layout-animation builder chains, so each method returns itself. */
function builder(): Entering {
  const self: Entering = {};
  for (const name of [
    "duration",
    "delay",
    "springify",
    "damping",
    "stiffness",
    "mass",
    "easing",
    "withInitialValues",
    "build",
    "randomDelay",
    "reduceMotion",
  ]) {
    self[name] = () => self;
  }
  return self;
}

/** Strip animation-only props so React Native does not see unknown keys. */
function stripped<P extends Record<string, unknown>>(props: P) {
  const { entering, exiting, layout, sharedTransitionTag, ...rest } = props;
  return rest;
}

function animate(Component: ComponentType<Record<string, unknown>>) {
  const Wrapped = forwardRef<unknown, Record<string, unknown>>((props, ref) => (
    <Component ref={ref} {...stripped(props)} />
  ));
  Wrapped.displayName = `Animated(${Component.displayName ?? "Component"})`;
  return Wrapped;
}

const AnimatedView = animate(View as never);
const AnimatedText = animate(Text as never);

export const FadeIn = builder();
export const FadeInDown = builder();
export const FadeInUp = builder();
export const FadeOut = builder();
export const FadeOutDown = builder();
export const LinearTransition = builder();
export const SlideInDown = builder();
export const SlideOutDown = builder();

export const Easing = {
  linear: (t: number) => t,
  ease: (t: number) => t,
  quad: (t: number) => t,
  cubic: (t: number) => t,
  bezier: () => (t: number) => t,
  in: (fn: (t: number) => number) => fn,
  out: (fn: (t: number) => number) => fn,
  inOut: (fn: (t: number) => number) => fn,
};

export function useSharedValue<T>(initial: T) {
  return { value: initial };
}

export function useDerivedValue<T>(fn: () => T) {
  return { value: fn() };
}

export function useAnimatedStyle<T>(fn: () => T) {
  return fn();
}

export function useAnimatedProps<T>(fn: () => T) {
  return fn();
}

export function useAnimatedRef() {
  return { current: null };
}

export function useReducedMotion() {
  return false;
}

/** Animations resolve to their destination at once. */
export const withTiming = <T,>(to: T) => to;
export const withSpring = <T,>(to: T) => to;
export const withDelay = <T,>(_delay: number, value: T) => value;
export const withSequence = <T,>(...values: T[]) => values[values.length - 1];
export const withRepeat = <T,>(value: T) => value;
export const withDecay = <T,>(value: T) => value;
export const cancelAnimation = () => {};
export const runOnJS =
  <A extends unknown[]>(fn: (...args: A) => unknown) =>
  (...args: A) =>
    fn(...args);
export const runOnUI =
  <A extends unknown[]>(fn: (...args: A) => unknown) =>
  (...args: A) =>
    fn(...args);

export function interpolate(
  value: number,
  input: number[],
  output: number[]
): number {
  const first = input[0] ?? 0;
  const last = input[input.length - 1] ?? 1;
  const from = output[0] ?? 0;
  const to = output[output.length - 1] ?? 0;
  if (last === first) return from;
  const t = Math.min(1, Math.max(0, (value - first) / (last - first)));
  return from + (to - from) * t;
}

export const interpolateColor = (_value: number, _input: number[], output: string[]) =>
  output[0] ?? "#000";

export const createAnimatedComponent = animate;
export const isSharedValue = (value: unknown) =>
  Boolean(value && typeof value === "object" && "value" in (value as object));

const Animated = {
  View: AnimatedView,
  Text: AnimatedText,
  Image: animate(Image as never),
  ScrollView: animate(ScrollView as never),
  createAnimatedComponent: animate,
};

export default Animated;
