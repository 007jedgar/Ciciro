import { useEffect, useState, type ReactElement } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useRouter, useSegments } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useProject } from "../lib/project";
import { useAppTheme } from "../lib/settings";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { Glass, alpha } from "./Glass";
import {
  ChaptersIcon,
  CiciroTabIcon,
  ContinueIcon,
  EditorIcon,
  NewChapterIcon,
  PlusIcon,
  QuestionIcon,
  QuoteIcon,
  RewriteIcon,
  SlidersIcon,
  SparkleIcon,
  TypeIcon,
} from "./icons";

const BUBBLE_W = 64;
const BUBBLE_H = 44;
const PILL_PAD = 10;
const PILL_HEIGHT = 60;
const FAB_SIZE = 60;
const BAR_MARGIN = 16;
/** Space between the elongated pill and the round action button. */
const BAR_GAP = 16;

/** Vertical room the floating bar needs so scroll content clears it. */
export const TAB_BAR_CLEARANCE = BAR_MARGIN + PILL_HEIGHT + 20;

/** Bottom padding for a manuscript tab's scroll content so nothing hides behind the bar. */
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + TAB_BAR_CLEARANCE;
}

const SPRING = { damping: 15, stiffness: 190, mass: 0.7 } as const;

type TabDef = {
  name: string;
  route: string;
  Icon: (p: { color: string; size?: number; focused?: boolean }) => ReactElement;
  labelKey: string;
};

type ActionDef = {
  key: string;
  Icon: (p: { color: string; size?: number }) => ReactElement;
  labelKey: string;
  tone: "ai" | "tool";
  run: () => void | Promise<void>;
};

export function ManuscriptTabBar({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { colors, dark } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const { addChapter } = useProject();
  const [open, setOpen] = useState(false);

  const tabs: TabDef[] = [
    { name: "chapters", route: `/project/${projectId}/chapters`, Icon: ChaptersIcon, labelKey: "project.chapters" },
    { name: "manuscript", route: `/project/${projectId}/manuscript`, Icon: EditorIcon, labelKey: "project.manuscript" },
    { name: "ciciro", route: `/project/${projectId}/ciciro`, Icon: CiciroTabIcon, labelKey: "project.ciciro" },
  ];
  const last = segments[segments.length - 1];
  const found = tabs.findIndex((tab) => tab.name === last);
  const activeIndex = found >= 0 ? found : 1;

  const progress = useSharedValue(0);
  const bubble = useSharedValue(activeIndex);
  const fabPress = useSharedValue(0);
  const seg = useSharedValue(0);

  useEffect(() => {
    progress.value = reduceMotion
      ? withTiming(open ? 1 : 0, { duration: 120 })
      : withSpring(open ? 1 : 0, SPRING);
  }, [open, reduceMotion, progress]);

  useEffect(() => {
    bubble.value = reduceMotion ? activeIndex : withSpring(activeIndex, SPRING);
  }, [activeIndex, reduceMotion, bubble]);

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  function goTab(route: string, index: number) {
    Haptics.selectionAsync().catch(() => {});
    if (index !== activeIndex) router.navigate(route as never);
  }

  function toggle() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setOpen((o) => !o);
  }

  function runAction(action: ActionDef) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setOpen(false);
    void action.run();
  }

  async function newChapter() {
    try {
      await addChapter();
      router.navigate(`/project/${projectId}/chapters` as never);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
  }

  const actions: ActionDef[] = [
    { key: "ask", Icon: SparkleIcon, labelKey: "manuscriptTabBar.ask", tone: "ai", run: () => router.navigate(`/project/${projectId}/ciciro` as never) },
    { key: "continue", Icon: ContinueIcon, labelKey: "manuscriptTabBar.continue", tone: "ai", run: () => router.navigate(`/project/${projectId}/ciciro?intent=continue` as never) },
    { key: "rewrite", Icon: RewriteIcon, labelKey: "manuscriptTabBar.rewrite", tone: "ai", run: () => router.navigate(`/project/${projectId}/ciciro?intent=rewrite` as never) },
    { key: "describe", Icon: QuoteIcon, labelKey: "manuscriptTabBar.describe", tone: "ai", run: () => router.navigate(`/project/${projectId}/ciciro?intent=describe` as never) },
    { key: "questions", Icon: QuestionIcon, labelKey: "manuscriptTabBar.questions", tone: "ai", run: () => router.navigate(`/project/${projectId}/ciciro?questions=1` as never) },
    { key: "newChapter", Icon: NewChapterIcon, labelKey: "manuscriptTabBar.newChapter", tone: "tool", run: newChapter },
    { key: "chapters", Icon: ChaptersIcon, labelKey: "manuscriptTabBar.chapters", tone: "tool", run: () => router.navigate(`/project/${projectId}/chapters` as never) },
    { key: "typography", Icon: TypeIcon, labelKey: "manuscriptTabBar.typography", tone: "tool", run: () => router.push("/settings") },
    { key: "settings", Icon: SlidersIcon, labelKey: "manuscriptTabBar.settings", tone: "tool", run: () => router.push("/settings") },
  ];

  const scrimStyle = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 1], [0, 0.45]) }));
  const pillStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.85], [1, 0], "clamp"),
    transform: [{ translateY: reduceMotion ? 0 : interpolate(progress.value, [0, 1], [0, 8]) }],
  }));
  const gridStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], "clamp"),
    transform: [
      { scale: reduceMotion ? 1 : interpolate(progress.value, [0, 1], [0.82, 1]) },
      { translateY: reduceMotion ? 0 : interpolate(progress.value, [0, 1], [10, 0]) },
    ],
  }));
  const fabIconStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${interpolate(progress.value, [0, 1], [0, 45])}deg` },
      { scale: interpolate(fabPress.value, [0, 1], [1, 0.9]) },
    ],
  }));
  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: bubble.value * seg.value + (seg.value - BUBBLE_W) / 2 }],
  }));

  const glassBubble = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.055)";

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={t("manuscriptTabBar.close")}
        onPress={() => setOpen(false)}
        pointerEvents={open ? "auto" : "none"}
        style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}
      />

      {/* Action grid, growing out of the FAB corner. */}
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={[
          styles.gridWrap,
          { right: BAR_MARGIN, bottom: insets.bottom + BAR_MARGIN + PILL_HEIGHT + 14 },
          gridStyle,
        ]}
      >
        <Glass dark={dark} colors={colors} radius={32} style={styles.gridPanel}>
          <View style={styles.gridRows}>
            {actions.map((action) => {
              const tint = action.tone === "ai" ? colors.accent : colors.ink;
              return (
                <Pressable
                  key={action.key}
                  accessibilityRole="button"
                  accessibilityLabel={t(action.labelKey)}
                  onPress={() => runAction(action)}
                  style={styles.cell}
                >
                  {({ pressed }) => (
                    <>
                      <View
                        style={[
                          styles.tile,
                          {
                            backgroundColor: alpha(colors.panel2, dark ? 0.55 : 0.7),
                            borderColor: alpha(colors.line, 0.7),
                            opacity: pressed ? 0.6 : 1,
                            transform: [{ scale: pressed ? 0.94 : 1 }],
                          },
                        ]}
                      >
                        <action.Icon color={tint} size={24} />
                      </View>
                      <Text numberOfLines={1} style={[styles.cellLabel, { color: colors.inkSoft }]}>
                        {t(action.labelKey)}
                      </Text>
                    </>
                  )}
                </Pressable>
              );
            })}
          </View>
        </Glass>
      </Animated.View>

      {/* Floating bar: glass pill of tabs + the round FAB. */}
      <View
        pointerEvents="box-none"
        style={[styles.barRow, { bottom: insets.bottom + BAR_MARGIN }]}
      >
        <Animated.View pointerEvents={open ? "none" : "auto"} style={[styles.pillWrap, pillStyle]}>
          <Glass dark={dark} colors={colors} radius={PILL_HEIGHT / 2} style={styles.pill}>
            <View
              style={styles.tabsRow}
              onLayout={(e) => (seg.value = e.nativeEvent.layout.width / tabs.length)}
            >
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.bubble,
                  { backgroundColor: glassBubble, borderColor: alpha(colors.line, 0.9) },
                  bubbleStyle,
                ]}
              />
              {tabs.map((tab, index) => {
                const focused = index === activeIndex;
                return (
                  <Pressable
                    key={tab.name}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: focused }}
                    accessibilityLabel={t(tab.labelKey)}
                    onPress={() => goTab(tab.route, index)}
                    style={styles.tab}
                  >
                    <tab.Icon color={focused ? colors.accent : colors.inkSoft} size={24} focused={focused} />
                  </Pressable>
                );
              })}
            </View>
          </Glass>
        </Animated.View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? t("manuscriptTabBar.close") : t("manuscriptTabBar.open")}
          onPress={toggle}
          onPressIn={() => (fabPress.value = withTiming(1, { duration: 90 }))}
          onPressOut={() => (fabPress.value = withTiming(0, { duration: 140 }))}
          style={[styles.fab, { backgroundColor: colors.accent, shadowColor: colors.accent }]}
        >
          <Animated.View style={fabIconStyle}>
            <PlusIcon color={colors.panel} size={22} />
          </Animated.View>
        </Pressable>
      </View>
    </View>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const styles = StyleSheet.create({
  scrim: { backgroundColor: "#000" },
  barRow: {
    position: "absolute",
    left: BAR_MARGIN,
    right: BAR_MARGIN,
    flexDirection: "row",
    alignItems: "center",
  },
  pillWrap: { flex: 1, marginRight: BAR_GAP },
  pill: {
    height: PILL_HEIGHT,
    paddingHorizontal: PILL_PAD,
  },
  tabsRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  bubble: {
    position: "absolute",
    top: (PILL_HEIGHT - BUBBLE_H) / 2,
    left: 0,
    width: BUBBLE_W,
    height: BUBBLE_H,
    borderRadius: BUBBLE_H / 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  gridWrap: { position: "absolute", transformOrigin: "100% 100%" },
  gridPanel: { padding: 16 },
  gridRows: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: 68 * 4,
  },
  cell: { width: 68, alignItems: "center", marginVertical: 8 },
  tile: {
    width: 56,
    height: 56,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  cellLabel: { marginTop: 7, fontSize: 11, fontWeight: "500", maxWidth: 66, textAlign: "center" },
});
