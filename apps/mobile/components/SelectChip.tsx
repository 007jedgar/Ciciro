import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Animated, { interpolate, interpolateColor, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { PRESS_SCALE } from "../lib/motion";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { useSelectionPop } from "../lib/use-selection-pop";
import { alpha } from "./Glass";
import { TapPressable } from "./TapPressable";

export type SelectTokens = {
  /** Surface fill when idle / selected. `transparent` is fine for an idle chip. */
  restFill: string;
  activeFill: string;
  restBorder: string;
  activeBorder: string;
  restText: string;
  activeText: string;
};

/** The tokens of a segmented control: the chosen segment lifts to the panel colour inside a `panel2` track. */
export function segmentSelectTokens(colors: { panel: string; ink: string; inkSoft: string }): SelectTokens {
  return {
    restFill: "transparent",
    activeFill: colors.panel,
    restBorder: "transparent",
    activeBorder: "transparent",
    restText: colors.inkSoft,
    activeText: colors.ink,
  };
}

type SelectState = { selected: boolean; progress: SharedValue<number>; tokens: SelectTokens; reduceMotion: boolean };

const SelectContext = createContext<SelectState | null>(null);

type Props = Omit<ComponentProps<typeof TapPressable>, "style" | "children" | "feedback"> & {
  selected: boolean;
  tokens: SelectTokens;
  /** Layout on the pressable itself (width, flex, margin). */
  style?: StyleProp<ViewStyle>;
  /** The visible chip: padding, radius, border width. Its fill and border colour are the crossfade's. */
  surfaceStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/**
 * A single-select control: a chip, day button or option row that answers a
 * choice with the shared crossfade and scale pop (`useSelectionPop`) instead of
 * a hard cut, the `select` haptic and the shared press feedback. Put the
 * label in `SelectLabel` (colour crossfades with the fill) and, for a row that
 * shows a tick when chosen, the tick in `SelectCheck`.
 */
export function SelectChip({ selected, tokens, style, surfaceStyle, children, scale, haptic = "select", ...rest }: Props) {
  const reduceMotion = useReduceMotion();
  const { progress, scale: pop } = useSelectionPop(selected, reduceMotion);
  const restFill = tokens.restFill === "transparent" ? alpha(tokens.activeFill, 0) : tokens.restFill;
  const restBorder = tokens.restBorder === "transparent" ? alpha(tokens.activeBorder, 0) : tokens.restBorder;
  const activeFill = tokens.activeFill;
  const activeBorder = tokens.activeBorder;

  const surface = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [restFill, activeFill]),
    borderColor: interpolateColor(progress.value, [0, 1], [restBorder, activeBorder]),
    transform: [{ scale: pop.value }],
  }));

  return (
    <TapPressable {...rest} scale={scale ?? PRESS_SCALE.chip} haptic={haptic} style={style}>
      <SelectContext.Provider value={{ selected, progress, tokens, reduceMotion }}>
        <Animated.View style={[surfaceStyle, surface]}>{children}</Animated.View>
      </SelectContext.Provider>
    </TapPressable>
  );
}

/** The label of a `SelectChip`: its colour crossfades from the idle to the selected text colour. */
export function SelectLabel({ style, children }: { style?: StyleProp<TextStyle>; children: ReactNode }) {
  const state = useContext(SelectContext);
  const restText = state?.tokens.restText ?? "#000";
  const activeText = state?.tokens.activeText ?? "#000";
  const progress = state?.progress;
  const animated = useAnimatedStyle(() => ({
    color: progress ? interpolateColor(progress.value, [0, 1], [restText, activeText]) : restText,
  }));
  return <Animated.Text style={[style, animated]}>{children}</Animated.Text>;
}

/** A tick that settles in when the `SelectChip` it sits in becomes the choice. */
export function SelectCheck({ children }: { children: ReactNode }) {
  const state = useContext(SelectContext);
  const progress = state?.progress;
  const reduceMotion = state?.reduceMotion ?? false;
  const animated = useAnimatedStyle(() => {
    const p = progress ? progress.value : 0;
    return { opacity: p, transform: [{ scale: reduceMotion ? 1 : interpolate(p, [0, 1], [0.6, 1]) }] };
  });
  return <Animated.View style={animated}>{children}</Animated.View>;
}
