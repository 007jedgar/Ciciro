import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Gesture, GestureDetector, ScrollView } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
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
const NEIGHBOUR_SPRING = { damping: 26, stiffness: 420, mass: 0.7 } as const;
const SETTLE_SPRING = { damping: 30, stiffness: 620, mass: 0.7 } as const;
const LIFT_SCALE = 1.03;
/** If the new order never arrives (the save failed), the row eases home after this. */
const SETTLE_FALLBACK_MS = 700;

/**
 * Where a drag stands. Only the dragged row's own motion (following the finger,
 * lifting) runs per frame on the UI thread; everyone else reacts to this, which
 * changes only when the finger crosses into another slot. It is stamped with the
 * order it was made for, so a row never acts on a drag whose reorder has landed.
 */
type DragState = { from: number; to: number; order: string };

const IDLE: DragState = { from: -1, to: -1, order: "" };

function OutlineRow({
  chapter,
  index,
  count,
  drag,
  order,
  reduceMotion,
  onOpen,
  onMove,
  onDragging,
  onSlot,
  onDrop,
}: {
  chapter: Chapter;
  index: number;
  count: number;
  drag: DragState;
  /** The current id order, to tell whether `drag` is still about it. */
  order: string;
  reduceMotion: boolean;
  onOpen: () => void;
  onMove: (to: number) => void;
  onDragging: (dragging: boolean) => void;
  onSlot: (from: number, to: number) => void;
  onDrop: (from: number, to: number) => void;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const layout = themed?.layout ?? parchmentLayout;
  const colors = themed?.colors ?? parchmentColors;
  const translateY = useSharedValue(0);
  const lifted = useSharedValue(0);
  const neighbour = useSharedValue(0);
  const lastSlot = useSharedValue(-1);
  // Locals, not module constants: worklets capture what is in their own scope.
  const rowHeight = OUTLINE_ROW_HEIGHT;
  const liftScale = LIFT_SCALE;
  const settle = SETTLE_SPRING;

  // A new order has been applied: this row is where it belongs now, so the
  // transient offsets are zeroed without animating (that would move it twice).
  useLayoutEffect(() => {
    cancelAnimation(translateY);
    cancelAnimation(neighbour);
    translateY.value = 0;
    neighbour.value = 0;
  }, [index, translateY, neighbour]);

  // Step aside for the dragged row.
  const shift = drag.order === order ? dragShift(index, drag.from, drag.to, rowHeight) : 0;
  useEffect(() => {
    neighbour.value = reduceMotion ? shift : withSpring(shift, NEIGHBOUR_SPRING);
  }, [shift, reduceMotion, neighbour]);

  // The drag ended without a new order (the save failed): ease the row home.
  const dragged = drag.from === index && drag.order === order;
  const wasDragged = useRef(false);
  useEffect(() => {
    if (wasDragged.current && !dragged) {
      translateY.value = reduceMotion ? 0 : withSpring(0, SETTLE_SPRING);
    }
    wasDragged.current = dragged;
  }, [dragged, reduceMotion, translateY]);

  const numbered = chapterNumberLabel(index + 1, (key, opts) => t(key, opts));
  const custom = customChapterTitle(chapter.title, numbered, t("chapters.newTitle"));
  const heading = custom ? `${numbered} · ${custom}` : numbered;
  const blurb = (chapter.summary.trim() || htmlToPlainText(htmlWithoutSuggestions(chapter.content))).trim();
  const status = normalizeChapterStatus(chapter.status);

  const pickUp = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  };
  const tick = () => {
    Haptics.selectionAsync().catch(() => {});
  };

  const pan = Gesture.Pan()
    // Recognised after a point of movement, ahead of the list's own scroll
    // gesture, so a drag that starts on the handle is never a scroll.
    .minDistance(1)
    .onBegin(() => {
      runOnJS(onDragging)(true);
    })
    .onStart(() => {
      lifted.value = reduceMotion ? 1 : withTiming(1, { duration: 120 });
      lastSlot.value = index;
      runOnJS(onSlot)(index, index);
      runOnJS(pickUp)();
    })
    .onUpdate((e) => {
      translateY.value = e.translationY;
      const slot = dropIndexFor(index, e.translationY, count, rowHeight);
      if (slot !== lastSlot.value) {
        lastSlot.value = slot;
        runOnJS(onSlot)(index, slot);
        runOnJS(tick)();
      }
    })
    .onEnd((e) => {
      const to = dropIndexFor(index, e.translationY, count, rowHeight);
      lifted.value = reduceMotion ? 0 : withTiming(0, { duration: 120 });
      const settled = (to - index) * rowHeight;
      // Settle into the slot, then hand the new order over.
      translateY.value = reduceMotion
        ? settled
        : withSpring(settled, settle, (finished) => {
            "worklet";
            if (finished) runOnJS(onDrop)(index, to);
          });
      if (reduceMotion) runOnJS(onDrop)(index, to);
    })
    .onFinalize((_e, success) => {
      // A touch that never became a drag, or was cancelled, must not leave the
      // list locked or a gap open.
      runOnJS(onDragging)(false);
      if (!success) {
        lifted.value = withTiming(0, { duration: 120 });
        translateY.value = withTiming(0, { duration: 120 });
        runOnJS(onDrop)(index, index);
      }
    });

  const rowStyle = useAnimatedStyle(() => {
    const isLifted = lifted.value;
    return {
      transform: [
        { translateY: translateY.value + neighbour.value },
        { scale: 1 + (liftScale - 1) * isLifted },
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
  slot,
  top,
  reduceMotion,
}: {
  /** The slot being held open, or -1 when nothing is being dragged. */
  slot: number;
  top: number;
  reduceMotion: boolean;
}) {
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const y = useSharedValue(top);
  const visible = useSharedValue(0);

  useEffect(() => {
    if (slot < 0) {
      visible.value = reduceMotion ? 0 : withTiming(0, { duration: 120 });
      return;
    }
    const target = top + slot * OUTLINE_ROW_HEIGHT;
    if (visible.value === 0) {
      // Appearing: land on the slot, do not slide in from wherever it last was.
      y.value = target;
      visible.value = reduceMotion ? 1 : withTiming(1, { duration: 120 });
    } else {
      y.value = reduceMotion ? target : withSpring(target, NEIGHBOUR_SPRING);
    }
  }, [slot, top, reduceMotion, y, visible]);

  const style = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [{ translateY: y.value }],
  }));
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
  const [drag, setDrag] = useState<DragState>(IDLE);
  const ids = chapters.map((c) => c.id);
  const orderKey = ids.join("|");
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The reordered list has arrived: the drag is over, and its offsets are moot.
  useLayoutEffect(() => {
    if (fallback.current) clearTimeout(fallback.current);
    fallback.current = null;
    setDrag(IDLE);
  }, [orderKey]);

  useEffect(
    () => () => {
      if (fallback.current) clearTimeout(fallback.current);
    },
    []
  );

  function drop(index: number, target: number) {
    if (target === index) {
      setDrag(IDLE);
      return;
    }
    onReorder(moveItem(ids, index, target));
    // The drop keeps its offsets until the new order lands, so rows do not spring
    // back and then jump; a save that never lands eases everything home.
    fallback.current = setTimeout(() => setDrag(IDLE), SETTLE_FALLBACK_MS);
  }

  const active = drag.order === orderKey ? drag : IDLE;

  return (
    <ScrollView
      scrollEnabled={!dragging}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop, paddingBottom }}
    >
      <InsertionGap slot={active.to} top={paddingTop} reduceMotion={reduceMotion} />
      {chapters.map((chapter, index) => (
        <OutlineRow
          key={chapter.id}
          chapter={chapter}
          index={index}
          count={chapters.length}
          drag={active}
          order={orderKey}
          reduceMotion={reduceMotion}
          onOpen={() => onOpen(chapter)}
          onMove={(target) => {
            if (target < 0 || target >= ids.length || target === index) return;
            onReorder(moveItem(ids, index, target));
          }}
          onDragging={setDragging}
          onSlot={(from, to) => setDrag({ from, to, order: orderKey })}
          onDrop={drop}
        />
      ))}
    </ScrollView>
  );
}
