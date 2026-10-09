import { useEffect, useState, type ReactElement } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import * as haptics from "../lib/haptics";
import { useRouter, useSegments } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useProject } from "../lib/project";
import { useSession } from "../lib/session";
import { bibleIndexHref } from "../lib/bible-files";
import { FOCUS_TRANSITION_MS } from "../lib/focus-mode";
import { useAppTheme } from "../lib/settings";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { loadWritingReminders } from "../lib/writing-reminder-store";
import { writingReminderEntryForProject } from "../lib/writing-reminder-sync";
import { openTodayEntry } from "../lib/journal";
import { normalizeKind } from "../lib/manuscript-kind";
import { keyboardHideProgress, tabBubble } from "../lib/manuscript-tab-bar";
import { Glass, alpha } from "./Glass";
import { StuckSheet } from "./StuckSheet";
import {
  BookIcon,
  ChaptersIcon,
  CiciroTabIcon,
  ContinueIcon,
  EditorIcon,
  NewChapterIcon,
  BellIcon,
  LifebuoyIcon,
  PlusIcon,
  QuestionIcon,
  QuoteIcon,
  RewriteIcon,
  SlidersIcon,
  SparkleIcon,
} from "./icons";
import { FAB_RELEASE_MS, PRESS_SCALE } from "../lib/motion";
import { TapPressable } from "./TapPressable";

const PILL_PAD = 10;
const PILL_HEIGHT = 60;
/** Gap between the selected-tab bubble and the pill's edge; the bubble nearly fills its segment. */
const BUBBLE_INSET = 4;
/** Gap between the bubble and the neighbouring tab, so a middle tab reads as a rounded rectangle. */
const BUBBLE_GAP = 6;
/** Corner radius of the bubble's inner (non-pill-hugging) ends: a super rounded rectangle. */
const BUBBLE_MID_RADIUS = 18;
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

/** Gap between one tile's spring and the next, so the menu fills in like a wave. */
const TILE_STAGGER_MS = 30;

/**
 * One tile of the action grid. Each springs in from a smaller scale a beat after
 * the one before it when the menu opens; closing drops them all at once with
 * the panel, so there is nothing to wait for.
 */
function ActionTile({
  index,
  open,
  reduceMotion,
  style,
  children,
}: {
  index: number;
  open: boolean;
  reduceMotion: boolean;
  style: object;
  children: ReactElement;
}) {
  const pop: SharedValue<number> = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      pop.value = open ? 1 : 0;
      return;
    }
    pop.value = open ? withDelay(index * TILE_STAGGER_MS, withSpring(1, SPRING)) : withTiming(0, { duration: 120 });
  }, [index, open, pop, reduceMotion]);
  const animated = useAnimatedStyle(() => ({
    opacity: interpolate(pop.value, [0, 1], [0, 1], "clamp"),
    transform: [{ scale: interpolate(pop.value, [0, 1], [0.6, 1]) }],
  }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

export function ManuscriptTabBar({ projectId, hidden = false }: { projectId: string; hidden?: boolean }) {
  const { t } = useTranslation();
  const { colors, dark } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const { addChapter, project, selectedChapterId, setSelectedChapterId } = useProject();
  const chapters = project?.chapters ?? [];
  const stuckChapterId = (chapters.find((c) => c.id === selectedChapterId) ?? chapters[0])?.id;
  const kind = normalizeKind(project?.kind);
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [stuckOpen, setStuckOpen] = useState(false);

  const openReminder = () => {
    const entry = writingReminderEntryForProject(
      user ? loadWritingReminders(user.id) : [],
      projectId
    );
    if (entry.kind === "list") {
      router.push("/writing-reminders");
      return;
    }
    if (entry.kind === "edit") {
      router.push({
        pathname: "/writing-reminder",
        params: {
          id: entry.reminderId,
          projectId,
          ...(project?.title ? { projectTitle: project.title } : {}),
        },
      } as never);
      return;
    }
    router.push({
      pathname: "/writing-reminder",
      params: {
        projectId,
        ...(project?.title ? { projectTitle: project.title } : {}),
      },
    } as never);
  };

  const tabs: TabDef[] = [
    { name: "chapters", route: `/project/${projectId}/chapters`, Icon: ChaptersIcon, labelKey: "project.chapters" },
    { name: "manuscript", route: `/project/${projectId}/manuscript`, Icon: EditorIcon, labelKey: "project.manuscript" },
    { name: "ciciro", route: `/project/${projectId}/ciciro`, Icon: CiciroTabIcon, labelKey: "project.ciciro" },
  ];
  const tabCount = tabs.length;
  const last = segments[segments.length - 1];
  const found = tabs.findIndex((tab) => tab.name === last);
  const activeIndex = found >= 0 ? found : 1;

  const progress = useSharedValue(0);
  const bubble = useSharedValue(activeIndex);
  const seg = useSharedValue(0);
  // 0 with the keyboard down, 1 with it up: the bar tucks below the screen edge
  // with the keyboard instead of being covered by it.
  const keyboard = useReanimatedKeyboardAnimation();
  // 0 shown, 1 tucked away: focus mode hides the bar the same way the keyboard does.
  const hiddenProgress = useSharedValue(hidden ? 1 : 0);

  useEffect(() => {
    hiddenProgress.value = withTiming(hidden ? 1 : 0, { duration: reduceMotion ? 1 : FOCUS_TRANSITION_MS });
  }, [hidden, reduceMotion, hiddenProgress]);

  useEffect(() => {
    progress.value = reduceMotion
      ? withTiming(open ? 1 : 0, { duration: 120 })
      : withSpring(open ? 1 : 0, SPRING);
  }, [open, reduceMotion, progress]);

  useEffect(() => {
    bubble.value = reduceMotion ? activeIndex : withSpring(activeIndex, SPRING);
  }, [activeIndex, reduceMotion, bubble]);

  useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  function goTab(route: string, index: number) {
    haptics.select();
    if (index !== activeIndex) router.navigate(route as never);
  }

  function toggle() {
    haptics.tap();
    setOpen((o) => !o);
  }

  function runAction(action: ActionDef) {
    haptics.tap();
    setOpen(false);
    void action.run();
  }

  async function newChapter() {
    try {
      if (kind === "journal") {
        await openTodayEntry(project?.chapters ?? [], (title) => addChapter(title), setSelectedChapterId);
        router.navigate(`/project/${projectId}/manuscript` as never);
        return;
      }
      await addChapter();
      router.navigate(`/project/${projectId}/chapters` as never);
    } catch {
      haptics.warning();
    }
  }

  const actions: ActionDef[] = [
    { key: "ask", Icon: SparkleIcon, labelKey: "manuscriptTabBar.ask", tone: "ai", run: () => router.navigate(`/project/${projectId}/ciciro` as never) },
    { key: "continue", Icon: ContinueIcon, labelKey: "manuscriptTabBar.continue", tone: "ai", run: () => router.navigate(`/project/${projectId}/ciciro?intent=continue` as never) },
    { key: "rewrite", Icon: RewriteIcon, labelKey: "manuscriptTabBar.rewrite", tone: "ai", run: () => router.navigate(`/project/${projectId}/ciciro?intent=rewrite` as never) },
    { key: "describe", Icon: QuoteIcon, labelKey: "manuscriptTabBar.describe", tone: "ai", run: () => router.navigate(`/project/${projectId}/ciciro?intent=describe` as never) },
    { key: "questions", Icon: QuestionIcon, labelKey: "manuscriptTabBar.questions", tone: "ai", run: () => router.navigate(`/project/${projectId}/ciciro?questions=1` as never) },
    ...(stuckChapterId
      ? [
          {
            key: "stuck",
            Icon: LifebuoyIcon,
            labelKey: "stuck.pill",
            tone: "ai" as const,
            run: () => setStuckOpen(true),
          },
        ]
      : []),
    { key: "bible", Icon: BookIcon, labelKey: "manuscriptTabBar.bible", tone: "tool", run: () => router.push(bibleIndexHref(projectId) as never) },
    // A blog post is a single piece, so there is nothing to add.
    ...(kind === "blog"
      ? []
      : [
          {
            key: "newChapter",
            Icon: NewChapterIcon,
            labelKey:
              kind === "journal"
                ? "manuscriptTabBar.todayEntry"
                : kind === "screenplay"
                  ? "manuscriptTabBar.newSequence"
                  : "manuscriptTabBar.newChapter",
            tone: "tool" as const,
            run: newChapter,
          },
        ]),
    {
      key: "reminder",
      Icon: BellIcon,
      labelKey: "manuscriptTabBar.reminder",
      tone: "tool",
      run: openReminder,
    },
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
    transform: [{ rotate: `${interpolate(progress.value, [0, 1], [0, 45])}deg` }],
  }));
  // Same-scope locals, not module constants, so the worklet below always has them on the UI runtime.
  const pad = PILL_PAD;
  const pillHeight = PILL_HEIGHT;
  const inset = BUBBLE_INSET;
  const gap = BUBBLE_GAP;
  const midRadius = BUBBLE_MID_RADIUS;
  const bubbleStyle = useAnimatedStyle(() => {
    const frame = tabBubble(bubble.value, tabCount, seg.value, pad, pillHeight, inset, gap, midRadius);
    return {
      left: frame.left,
      width: frame.width,
      borderTopLeftRadius: frame.leftRadius,
      borderBottomLeftRadius: frame.leftRadius,
      borderTopRightRadius: frame.rightRadius,
      borderBottomRightRadius: frame.rightRadius,
    };
  });

  const barRowStyle = useAnimatedStyle(() => {
    const hideProgress = Math.max(keyboardHideProgress(keyboard.height.value), hiddenProgress.value);
    return {
      opacity: interpolate(hideProgress, [0, 0.7], [1, 0], "clamp"),
      transform: [
        {
          translateY: reduceMotion
            ? 0
            : interpolate(hideProgress, [0, 1], [0, insets.bottom + BAR_MARGIN + PILL_HEIGHT + 24]),
        },
      ],
    };
  });

  const glassBubble = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.055)";

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={hidden ? "none" : "box-none"}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
    >
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
            {actions.map((action, index) => {
              const tint = action.tone === "ai" ? colors.accent : colors.ink;
              return (
                <TapPressable
                  key={action.key}
                  accessibilityRole="button"
                  accessibilityLabel={t(action.labelKey)}
                  onPress={() => runAction(action)}
                  scale={PRESS_SCALE.chip}
                  style={styles.cell}
                >
                  <ActionTile
                  index={index}
                  open={open}
                  reduceMotion={reduceMotion}
                  style={[
                    styles.tile,
                    {
                      backgroundColor: alpha(colors.panel2, dark ? 0.55 : 0.7),
                      borderColor: alpha(colors.line, 0.7),
                    },
                  ]}
                >
                  <action.Icon color={tint} size={24} />
                </ActionTile>
                <Text numberOfLines={2} style={[styles.cellLabel, { color: colors.inkSoft }]}>
                  {t(action.labelKey)}
                </Text>
                </TapPressable>
              );
            })}
          </View>
        </Glass>
      </Animated.View>

      {/* Floating bar: glass pill of tabs + the round FAB. */}
      <Animated.View
        pointerEvents="box-none"
        style={[styles.barRow, { bottom: insets.bottom + BAR_MARGIN }, barRowStyle]}
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
                  <TapPressable
                    key={tab.name}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: focused }}
                    accessibilityLabel={t(tab.labelKey)}
                    onPress={() => goTab(tab.route, index)}
                    scale={PRESS_SCALE.chip}
                    style={styles.tab}
                  >
                    <tab.Icon color={focused ? colors.accent : colors.inkSoft} size={22} focused={focused} />
                    <Text
                      numberOfLines={1}
                      style={[styles.tabLabel, { color: focused ? colors.accent : colors.inkSoft }]}
                    >
                      {t(tab.labelKey)}
                    </Text>
                  </TapPressable>
                );
              })}
            </View>
          </Glass>
        </Animated.View>

        <TapPressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? t("manuscriptTabBar.close") : t("manuscriptTabBar.open")}
          onPress={toggle}
          scale={PRESS_SCALE.fab}
          releaseMs={FAB_RELEASE_MS}
          style={[styles.fab, { backgroundColor: colors.accent, shadowColor: colors.accent }]}
        >
          <Animated.View style={fabIconStyle}>
            <PlusIcon color={colors.panel} size={22} />
          </Animated.View>
        </TapPressable>
      </Animated.View>
      {stuckChapterId ? (
        <StuckSheet
          open={stuckOpen}
          onClose={() => setStuckOpen(false)}
          projectId={projectId}
          chapterId={stuckChapterId}
        />
      ) : null}
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
    top: BUBBLE_INSET,
    height: PILL_HEIGHT - BUBBLE_INSET * 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  // Icons alone left three tabs a first-time writer had to guess at.
  tabLabel: { fontSize: 10.5, lineHeight: 12, fontWeight: "600" },
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
    width: 76 * 4,
  },
  cell: { width: 76, alignItems: "center", marginVertical: 8 },
  tile: {
    width: 56,
    height: 56,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  cellLabel: {
    marginTop: 7,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "500",
    maxWidth: 72,
    minHeight: 26,
    textAlign: "center",
  },
});
