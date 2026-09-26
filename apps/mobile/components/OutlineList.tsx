import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { customChapterTitle, chapterNumberLabel } from "../lib/chapter-label";
import { normalizeChapterStatus } from "../lib/chapter-status";
import { htmlToPlainText } from "../lib/html";
import { dropIndexFor, moveItem, OUTLINE_ROW_HEIGHT } from "../lib/outline";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import type { Chapter } from "../lib/types";

type Props = {
  chapters: Chapter[];
  paddingTop?: number;
  paddingBottom?: number;
  onOpen: (chapter: Chapter) => void;
  /** The full id order after a drag or an accessibility move. */
  onReorder: (ids: string[]) => void;
};

function OutlineRow({
  chapter,
  index,
  count,
  hovered,
  onOpen,
  onMove,
  onHover,
  onDragging,
}: {
  chapter: Chapter;
  index: number;
  count: number;
  hovered: boolean;
  onOpen: () => void;
  onMove: (to: number) => void;
  onHover: (to: number | null) => void;
  onDragging: (dragging: boolean) => void;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const layout = themed?.layout ?? parchmentLayout;
  const colors = themed?.colors ?? parchmentColors;
  const translateY = useSharedValue(0);
  const lifted = useSharedValue(0);

  const numbered = chapterNumberLabel(index + 1, (key, opts) => t(key, opts));
  const custom = customChapterTitle(chapter.title, numbered, t("chapters.newTitle"));
  const heading = custom ? `${numbered} · ${custom}` : numbered;
  const blurb = (chapter.summary.trim() || htmlToPlainText(chapter.content)).trim();
  const status = normalizeChapterStatus(chapter.status);

  const drag = Gesture.Pan()
    .onStart(() => {
      lifted.value = 1;
      runOnJS(onDragging)(true);
    })
    .onUpdate((e) => {
      translateY.value = e.translationY;
      runOnJS(onHover)(dropIndexFor(index, e.translationY, count));
    })
    .onEnd((e) => {
      const to = dropIndexFor(index, e.translationY, count);
      translateY.value = to === index ? withTiming(0, { duration: 120 }) : 0;
      lifted.value = 0;
      runOnJS(onHover)(null);
      runOnJS(onDragging)(false);
      if (to !== index) runOnJS(onMove)(to);
    });

  const liftedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    zIndex: lifted.value ? 10 : 0,
    opacity: lifted.value ? 0.92 : 1,
  }));

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
        },
        hovered ? { borderColor: colors.accent, backgroundColor: colors.accentSoft } : null,
        liftedStyle,
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
      <GestureDetector gesture={drag}>
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

export function OutlineList({ chapters, paddingTop = 0, paddingBottom = 0, onOpen, onReorder }: Props) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const ids = chapters.map((c) => c.id);

  return (
    <ScrollView
      scrollEnabled={!dragging}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop, paddingBottom }}
    >
      {chapters.map((chapter, index) => (
        <OutlineRow
          key={chapter.id}
          chapter={chapter}
          index={index}
          count={chapters.length}
          hovered={hoverIndex === index}
          onOpen={() => onOpen(chapter)}
          onMove={(to) => {
            if (to < 0 || to >= ids.length || to === index) return;
            onReorder(moveItem(ids, index, to));
          }}
          onHover={setHoverIndex}
          onDragging={setDragging}
        />
      ))}
    </ScrollView>
  );
}
