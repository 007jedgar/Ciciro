import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { customChapterTitle, chapterNumberLabel } from "../lib/chapter-label";
import { normalizeChapterStatus } from "../lib/chapter-status";
import { htmlToPlainText } from "../lib/html";
import { htmlWithoutSuggestions } from "../lib/suggestions";
import { dragShift, dropIndexFor, moveItem, OUTLINE_ROW_HEIGHT } from "../lib/outline";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import { useReduceMotion } from "../lib/use-reduce-motion";
import type { Chapter } from "../lib/types";

type Props = {
  chapters: Chapter[];
  paddingTop?: number;
  paddingBottom?: number;
  onOpen: (chapter: Chapter) => void;
  /** The full id order after a drag or an accessibility move. */
  onReorder: (ids: string[]) => void;
};

/** Neighbours make room on a short spring; the drop settles on a shorter one. */
const NEIGHBOUR_SPRING = { duration: 150, dampingRatio: 0.85 } as const;
const SETTLE_SPRING = { duration: 120, dampingRatio: 0.9 } as const;
const LIFT_SCALE = 1.03;
/** If the new order never arrives (the save failed), the row eases home after this. */
const SETTLE_FALLBACK_MS = 700;

/** Drag state shared by every row, so neighbours can react without re-rendering. */
type DragState = {
  /** Index of the row being dragged, or -1. */
  from: SharedValue<number>;
  /** Slot the dragged row would land in, or -1. */
  to: SharedValue<number>;
};

function OutlineRow({
  chapter,
  index,
  count,
  drag: state,
  reduceMotion,
  onOpen,
  onMove,
  onDragging,
  onDrop,
}: {
  chapter: Chapter;
  index: number;
  count: number;
  drag: DragState;
  reduceMotion: boolean;
  onOpen: () => void;
  onMove: (to: number) => void;
  onDragging: (dragging: boolean) => void;
  onDrop: (from: number, to: number) => void;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const layout = themed?.layout ?? parchmentLayout;
  const colors = themed?.colors ?? parchmentColors;
  const translateY = useSharedValue(0);
  const lifted = useSharedValue(0);
  const neighbour = useSharedValue(0);

  // A new order has been applied: this row is where it belongs now, so the
  // transient offsets are zeroed without animating (that would move it twice).
  useLayoutEffect(() => {
    cancelAnimation(translateY);
    cancelAnimation(neighbour);
    translateY.value = 0;
    neighbour.value = 0;
  }, [index, translateY, neighbour]);

  useAnimatedReaction(
    () => dragShift(index, state.from.value, state.to.value),
    (shift, previous) => {
      if (previous === null || shift === previous) return;
      neighbour.value = reduceMotion ? shift : withSpring(shift, NEIGHBOUR_SPRING);
    },
    [index, reduceMotion]
  );

  // A drop whose new order never arrived: the dragged row eases back to its slot.
  useAnimatedReaction(
    () => state.from.value,
    (current, previous) => {
      if (current === -1 && previous === index && translateY.value !== 0) {
        translateY.value = reduceMotion ? 0 : withSpring(0, SETTLE_SPRING);
      }
    },
    [index, reduceMotion]
  );

  const numbered = chapterNumberLabel(index + 1, (key, opts) => t(key, opts));
  const custom = customChapterTitle(chapter.title, numbered, t("chapters.newTitle"));
  const heading = custom ? `${numbered} · ${custom}` : numbered;
  const blurb = (chapter.summary.trim() || htmlToPlainText(htmlWithoutSuggestions(chapter.content))).trim();
  const status = normalizeChapterStatus(chapter.status);

  const pickUp = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  };

  const pan = Gesture.Pan()
    .onStart(() => {
      lifted.value = reduceMotion ? 1 : withSpring(1, SETTLE_SPRING);
      state.from.value = index;
      state.to.value = index;
      runOnJS(onDragging)(true);
      runOnJS(pickUp)();
    })
    .onUpdate((e) => {
      translateY.value = e.translationY;
      state.to.value = dropIndexFor(index, e.translationY, count);
    })
    .onEnd((e) => {
      const to = dropIndexFor(index, e.translationY, count);
      state.to.value = to;
      lifted.value = reduceMotion ? 0 : withSpring(0, SETTLE_SPRING);
      runOnJS(onDragging)(false);
      const settled = (to - index) * OUTLINE_ROW_HEIGHT;
      // Settle into the slot, then hand the new order over.
      translateY.value = reduceMotion
        ? withTiming(settled, { duration: 0 })
        : withSpring(settled, SETTLE_SPRING, (finished) => {
            "worklet";
            if (finished) runOnJS(onDrop)(index, to);
          });
      if (reduceMotion) runOnJS(onDrop)(index, to);
    });

  const rowStyle = useAnimatedStyle(() => {
    const isLifted = lifted.value;
    return {
      transform: [
        { translateY: translateY.value + neighbour.value },
        { scale: 1 + (LIFT_SCALE - 1) * isLifted },
      ],
      zIndex: isLifted > 0 ? 10 : 0,
      shadowOpacity: 0.28 * isLifted,
      shadowRadius: 14 * isLifted,
      shadowOffset: { width: 0, height: 8 * isLifted },
      elevation: 8 * isLifted,
    };
  });

  return (
    <Animated.View
      style={[
        layout.card,
        {
          height: OUTLINE_ROW_HEIGHT - 12,
          marginBottom: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          shadowColor: colors.ink,
        },
        rowStyle,
      ]}
      accessible
      accessibilityLabel={heading}
      accessibilityActions={[
        { name: "moveUp", label: t("outline.moveUp") },
        { name: "moveDown", label: t("outline.moveDown") },
      ]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "moveUp") onMove(index - 1);
        if (e.nativeEvent.actionName === "moveDown") onMove(index + 1);
      }}
    >
      <GestureDetector gesture={pan}>
        <View
          testID="outline-handle"
          accessibilityRole="adjustable"
          accessibilityLabel={t("outline.dragHandleA11y", { title: custom ?? numbered })}
          hitSlop={8}
          style={{ width: 28, alignItems: "center", justifyContent: "center", gap: 3 }}
        >
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{ width: 16, height: 2, borderRadius: 1, backgroundColor: colors.inkSoft }}
            />
          ))}
        </View>
      </GestureDetector>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={layout.cardTitle} numberOfLines={1} onPress={onOpen} suppressHighlighting>
          {heading}
        </Text>
        <Text style={layout.cardMeta}>
          {t("chapters.wordCount", { count: chapter.wordCount })} · {t(`chapters.status.${status}`)}
        </Text>
        {blurb ? (
          <Text style={layout.cardMeta} numberOfLines={2} ellipsizeMode="tail">
            {blurb}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

/** The dashed outline of the slot the dragged chapter will land in. */
function InsertionGap({
  state,
  top,
  reduceMotion,
}: {
  state: DragState;
  top: number;
  reduceMotion: boolean;
}) {
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const style = useAnimatedStyle(() => {
    const slot = state.to.value;
    const y = top + Math.max(0, slot) * OUTLINE_ROW_HEIGHT;
    return {
      opacity: state.from.value >= 0 ? 1 : 0,
      transform: [{ translateY: reduceMotion ? y : withSpring(y, NEIGHBOUR_SPRING) }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      testID="outline-insertion-gap"
      style={[
        {
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: OUTLINE_ROW_HEIGHT - 12,
          borderRadius: 10,
          borderWidth: 1.5,
          borderStyle: "dashed",
          borderColor: colors.accent,
          backgroundColor: colors.accentSoft,
        },
        style,
      ]}
    />
  );
}

export function OutlineList({ chapters, paddingTop = 0, paddingBottom = 0, onOpen, onReorder }: Props) {
  const reduceMotion = useReduceMotion();
  const [dragging, setDragging] = useState(false);
  const ids = chapters.map((c) => c.id);
  const orderKey = ids.join("|");
  const from = useSharedValue(-1);
  const to = useSharedValue(-1);
  const state: DragState = { from, to };
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDrag = () => {
    from.value = -1;
    to.value = -1;
  };

  // The drop keeps its offsets until the reordered list arrives, so rows do not
  // spring back and then jump; a row that never got its new order eases home.
  useLayoutEffect(() => {
    if (fallback.current) clearTimeout(fallback.current);
    fallback.current = null;
    clearDrag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);

  useEffect(
    () => () => {
      if (fallback.current) clearTimeout(fallback.current);
    },
    []
  );

  function drop(index: number, target: number) {
    if (target === index) {
      clearDrag();
      return;
    }
    onReorder(moveItem(ids, index, target));
    fallback.current = setTimeout(clearDrag, SETTLE_FALLBACK_MS);
  }

  return (
    <ScrollView
      scrollEnabled={!dragging}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop, paddingBottom }}
    >
      <InsertionGap state={state} top={paddingTop} reduceMotion={reduceMotion} />
      {chapters.map((chapter, index) => (
        <OutlineRow
          key={chapter.id}
          chapter={chapter}
          index={index}
          count={chapters.length}
          drag={state}
          reduceMotion={reduceMotion}
          onOpen={() => onOpen(chapter)}
          onMove={(target) => {
            if (target < 0 || target >= ids.length || target === index) return;
            onReorder(moveItem(ids, index, target));
          }}
          onDragging={setDragging}
          onDrop={drop}
        />
      ))}
    </ScrollView>
  );
}
