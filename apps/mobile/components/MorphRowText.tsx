import { useEffect, useRef } from "react";
import { StyleSheet, Text, type NativeMethods, type TextProps } from "react-native";
import {
  type MorphTitleStyle,
  useMorphHidden,
  useSharedTitleMorph,
} from "../lib/shared-title-morph";
import { useReduceMotion } from "../lib/use-reduce-motion";

/**
 * A list row's title, registered as the source end of a shared-title morph
 * (see `shared-title-morph.tsx`). Renders exactly like `Text`; call
 * `beginRowMorph(morphKey)` from the row's `onPress`, before navigating, to
 * measure this node and start the morph.
 */
export function MorphRowText({
  morphKey,
  morphStyle,
  style,
  children,
  ...props
}: Omit<TextProps, "children"> & {
  morphKey: string;
  /** The subset of `style` the morph needs to know numerically - font size/family/color. */
  morphStyle: MorphTitleStyle;
  children: string;
}) {
  const ref = useRef<Text & NativeMethods>(null);
  const morph = useSharedTitleMorph();
  const reduceMotion = useReduceMotion();
  const hidden = useMorphHidden(reduceMotion ? null : morphKey);

  useEffect(() => {
    if (!morph || reduceMotion) return;
    return morph.registerSource(morphKey, {
      text: children,
      style: morphStyle,
      measure: () =>
        new Promise((resolve) => {
          const node = ref.current;
          if (!node?.measureInWindow) {
            resolve(null);
            return;
          }
          node.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
        }),
    });
    // morphStyle/children are read fresh by measure()'s closure on each registration.
  }, [morph, morphKey, morphStyle, children, reduceMotion]);

  return (
    <Text ref={ref} style={[style, hidden ? styles.hidden : null]} {...props}>
      {children}
    </Text>
  );
}

/** Measures this row's registered source, then lets the caller navigate once it has. */
export async function beginRowMorph(
  morph: ReturnType<typeof useSharedTitleMorph>,
  morphKey: string
): Promise<void> {
  if (!morph) return;
  await morph.beginForward(morphKey);
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
});
