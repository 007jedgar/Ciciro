import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Redirect, Tabs, useLocalSearchParams, useRouter, useSegments } from "expo-router";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { AppHeader, AppHeaderHeightContext } from "../../../../components/AppHeader";
import { ManuscriptTabBar } from "../../../../components/ManuscriptTabBar";
import { SkeletonList } from "../../../../components/Skeleton";
import { WritingMeter } from "../../../../components/WritingMeter";
import { ManuscriptPaceLabel } from "../../../../components/ManuscriptPaceLabel";
import { FocusIcon, HeadphonesIcon } from "../../../../components/icons";
import { useProject } from "../../../../lib/project";
import { useSession } from "../../../../lib/session";
import { FOCUS_TRANSITION_MS, focusChromeHidden, setFocusMode, useFocusMode } from "../../../../lib/focus-mode";
import * as haptics from "../../../../lib/haptics";
import { useAppTheme } from "../../../../lib/settings";
import { TAB_SLIDE_SPEC, tabSlideInterpolator } from "../../../../lib/manuscript-tab-slide";
import { useReduceMotion } from "../../../../lib/use-reduce-motion";
import { useStackBack } from "../../../../lib/use-stack-back";

/** Height of the slim row that holds the exit control while focus mode hides the header. */
const FOCUS_BAR_HEIGHT = 36;

/** A tappable pill (icon plus label) for the tools row under the project title. */
function ToolButton({
  label,
  Icon,
  onPress,
}: {
  label: string;
  Icon: (p: { color: string; size?: number }) => ReactElement;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={haptics.withTap(onPress)}
      hitSlop={6}
      style={({ pressed }) => [
        styles.tool,
        { borderColor: colors.line, backgroundColor: colors.panel, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Icon color={colors.accent} size={16} />
      <Text style={[styles.toolText, { color: colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

function ProjectHeader({
  showMeter,
  onHeightChange,
}: {
  showMeter: boolean;
  onHeightChange: (height: number, withMeter: boolean) => void;
}) {
  const { colors } = useAppTheme();
  const router = useRouter();
  const { backTo } = useStackBack();
  const { t } = useTranslation();
  const { project } = useProject();
  const manuscriptWords = (project?.chapters ?? []).reduce(
    (sum, chapter) => sum + (chapter.archivedAt ? 0 : chapter.wordCount || 0),
    0
  );
  return (
    <AppHeader
      title={project?.title || t("project.untitled")}
      // Pops to the list when it is underneath, and swaps to it when the app
      // was restored straight onto this manuscript and there is nothing under.
      onBack={() => backTo("/manuscripts")}
      backAccessibilityLabel={t("project.backToManuscripts")}
      onSettings={() => router.push("/settings")}
      floating
      accessory={
        showMeter && project ? (
          <>
            <View style={styles.tools}>
              <ToolButton
                label={t("settings.focusMode")}
                Icon={FocusIcon}
                onPress={() => setFocusMode(true)}
              />
              <ToolButton
                label={t("readAloud.open")}
                Icon={HeadphonesIcon}
                onPress={() => router.push(`/project/${project.id}/listen` as never)}
              />
            </View>
            <WritingMeter />
            <ManuscriptPaceLabel projectId={project.id} manuscriptWords={manuscriptWords} />
          </>
        ) : null
      }
      onHeightChange={(height) => onHeightChange(height, showMeter)}
    />
  );
}

export default function ProjectTabsLayout() {
  const { backTo } = useStackBack();
  const { t } = useTranslation();
  const { user, ready } = useSession();
  const { layout, colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  // A tab slides in from the side it sits on. Reduce motion cross-fades instead.
  const tabAnimation = useMemo(
    () =>
      reduceMotion
        ? ({ animation: "fade" } as const)
        : {
            transitionSpec: TAB_SLIDE_SPEC,
            sceneStyleInterpolator: tabSlideInterpolator(width),
          },
    [reduceMotion, width]
  );
  const { id } = useLocalSearchParams<{ id: string }>();
  const segments = useSegments();
  const onEditor = segments[segments.length - 1] === "manuscript";
  // Tabs scroll under the floating header, so they need its measured height.
  // The meter row only shows over the manuscript tab, so each height is kept
  // apart: a tab off screen keeps the layout it will slide back in with,
  // rather than taking on the other tab's header and jumping on its return.
  const [headerHeights, setHeaderHeights] = useState<{ plain: number | null; meter: number | null }>({
    plain: null,
    meter: null,
  });
  const onHeaderHeight = useCallback((height: number, withMeter: boolean) => {
    setHeaderHeights((prev) => {
      const key = withMeter ? "meter" : "plain";
      return prev[key] === height ? prev : { ...prev, [key]: height };
    });
  }, []);
  const focusMode = useFocusMode();
  const focused = focusChromeHidden(focusMode, onEditor);
  const focusValue = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    focusValue.value = withTiming(focused ? 1 : 0, { duration: reduceMotion ? 1 : FOCUS_TRANSITION_MS });
  }, [focused, reduceMotion, focusValue]);
  // The header fades and lifts away as focus comes in; the exit-focus bar does
  // the mirror move, sliding down into the space the header vacated.
  const headerStyle = useAnimatedStyle(() => {
    const amount = focusValue.value;
    return { opacity: 1 - amount, transform: [{ translateY: -12 * amount }] };
  });
  const exitBarStyle = useAnimatedStyle(() => {
    const amount = focusValue.value;
    return { opacity: amount, transform: [{ translateY: -12 * (1 - amount) }] };
  });
  const screenLayout = useCallback(
    ({ route, children }: { route: { name: string }; children: ReactNode }) => {
      const editor = route.name === "manuscript";
      const height = focusChromeHidden(focusMode, editor)
        ? insets.top + FOCUS_BAR_HEIGHT
        : editor
          ? headerHeights.meter
          : headerHeights.plain;
      return <AppHeaderHeightContext.Provider value={height}>{children}</AppHeaderHeightContext.Provider>;
    },
    [focusMode, insets.top, headerHeights]
  );

  if (!ready) {
    return (
      <View style={[layout.screen, { paddingHorizontal: 20, paddingTop: 24 }]}>
        <SkeletonList count={5} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;
  if (!id || Array.isArray(id)) {
    return (
      <View style={layout.screen}>
        <AppHeader
          title={t("project.manuscript")}
          onBack={() => backTo("/manuscripts")}
          backAccessibilityLabel={t("project.backToManuscripts")}
        />
        <View style={layout.padded}>
          <Text style={layout.error}>{t("project.missingId")}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={layout.screen}>
      <Animated.View
        pointerEvents={focused ? "none" : "box-none"}
        accessibilityElementsHidden={focused}
        importantForAccessibility={focused ? "no-hide-descendants" : "auto"}
        style={[{ zIndex: 20 }, headerStyle]}
      >
        <ProjectHeader showMeter={onEditor} onHeightChange={onHeaderHeight} />
      </Animated.View>
      <Animated.View
        pointerEvents={focused ? "box-none" : "none"}
        accessibilityElementsHidden={!focused}
        importantForAccessibility={focused ? "auto" : "no-hide-descendants"}
        style={[
          {
            position: "absolute",
            top: insets.top,
            left: 0,
            right: 0,
            height: FOCUS_BAR_HEIGHT,
            zIndex: 10,
            flexDirection: "row",
            justifyContent: "flex-end",
            alignItems: "center",
            paddingHorizontal: 16,
          },
          exitBarStyle,
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("settings.exitFocus")}
          onPress={() => setFocusMode(false)}
          hitSlop={12}
          style={{ opacity: 0.45 }}
        >
          <Text style={{ fontSize: 13, color: colors.inkSoft }}>{t("settings.exitFocus")}</Text>
        </Pressable>
      </Animated.View>
      <View style={{ flex: 1 }}>
        <Tabs
          backBehavior="none"
          tabBar={() => null}
          screenLayout={screenLayout}
          screenOptions={{
            headerShown: false,
            sceneStyle: { backgroundColor: colors.bg },
            ...tabAnimation,
          }}
        >
          <Tabs.Screen name="chapters" options={{ title: t("project.chapters") }} />
          <Tabs.Screen name="manuscript" options={{ title: t("project.manuscript") }} />
          <Tabs.Screen name="ciciro" options={{ title: t("project.ciciro") }} />
          <Tabs.Screen name="index" options={{ href: null }} />
        </Tabs>
        <ManuscriptTabBar projectId={id} hidden={focused} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tools: { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingBottom: 10 },
  tool: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  toolText: { fontSize: 13, fontWeight: "600" },
});
