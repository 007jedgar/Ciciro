import { useEffect } from "react";
import { Text } from "react-native";
import { useSharedValue, withTiming } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { EASE_OUT } from "../lib/motion";
import { useAppTheme } from "../lib/settings";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { DrawCheck, useDrawProgress } from "./DrawCheck";
import { ProgressRing } from "./ProgressRing";

/** The ring fills to the words written over this long, then holds. */
const FILL_MS = 640;

/**
 * Words written over the word target as a ring that fills and, at the target,
 * closes with a tick drawn inside it. Its middle is the percent while there is
 * more to write. Reduce motion shows the ring as it stands.
 */
export function DeadlineRing({
  progress,
  complete,
  size,
  strokeWidth,
}: {
  /** 0 to 1. */
  progress: number;
  complete: boolean;
  size: number;
  strokeWidth: number;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const ring = useSharedValue(reduceMotion ? progress : 0);
  useEffect(() => {
    ring.value = reduceMotion ? progress : withTiming(progress, { duration: FILL_MS, easing: EASE_OUT });
  }, [progress, reduceMotion, ring]);
  const tick = useDrawProgress(complete, FILL_MS);
  const percent = Math.floor(progress * 100);

  return (
    <ProgressRing progress={ring} size={size} strokeWidth={strokeWidth} color={colors.accent} trackColor={colors.line}>
      {complete ? (
        <DrawCheck progress={tick} color={colors.accent} size={Math.round(size * 0.4)} strokeWidth={2.2} />
      ) : (
        <Text
          accessibilityLabel={t("deadline.percentA11y", { percent })}
          style={{
            color: colors.ink,
            fontSize: Math.round(size * 0.24),
            fontVariant: ["tabular-nums"],
          }}
        >
          {`${percent}%`}
        </Text>
      )}
    </ProgressRing>
  );
}
