import { useState } from "react";
import { Redirect, Tabs, useLocalSearchParams, useRouter, useSegments } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppHeader, AppHeaderHeightContext } from "../../../../components/AppHeader";
import { ManuscriptTabBar } from "../../../../components/ManuscriptTabBar";
import { SkeletonList } from "../../../../components/Skeleton";
import { WritingMeter } from "../../../../components/WritingMeter";
import { ManuscriptPaceLabel } from "../../../../components/ManuscriptPaceLabel";
import { useProject } from "../../../../lib/project";
import { useSession } from "../../../../lib/session";
import { focusChromeHidden, setFocusMode, useFocusMode } from "../../../../lib/focus-mode";
import { useAppTheme } from "../../../../lib/settings";
import { useStackBack } from "../../../../lib/use-stack-back";

/** Height of the slim row that holds the exit control while focus mode hides the header. */
const FOCUS_BAR_HEIGHT = 36;

function ProjectHeader({
  showMeter,
  onHeightChange,
}: {
  showMeter: boolean;
  onHeightChange: (height: number) => void;
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("settings.focusMode")}
              onPress={() => setFocusMode(true)}
              hitSlop={8}
            >
              <Text style={{ fontSize: 13, color: colors.inkSoft }}>{t("settings.focusMode")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("readAloud.open")}
              onPress={() => router.push(`/project/${project.id}/listen` as never)}
              hitSlop={8}
            >
              <Text style={{ fontSize: 13, color: colors.inkSoft }}>{t("readAloud.open")}</Text>
            </Pressable>
            <WritingMeter />
            <ManuscriptPaceLabel projectId={project.id} manuscriptWords={manuscriptWords} />
          </>
        ) : null
      }
      onHeightChange={onHeightChange}
    />
  );
}

export default function ProjectTabsLayout() {
  const { backTo } = useStackBack();
  const { t } = useTranslation();
  const { user, ready } = useSession();
  const { layout, colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const segments = useSegments();
  const onEditor = segments[segments.length - 1] === "manuscript";
  // Tabs scroll under the floating header, so they need its measured height.
  const [headerHeight, setHeaderHeight] = useState<number | null>(null);
  const focused = focusChromeHidden(useFocusMode(), onEditor);

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
    <AppHeaderHeightContext.Provider value={focused ? insets.top + FOCUS_BAR_HEIGHT : headerHeight}>
      <View style={layout.screen}>
        {focused ? (
          <View
            style={{
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
            }}
            pointerEvents="box-none"
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
          </View>
        ) : (
          <ProjectHeader showMeter={onEditor} onHeightChange={setHeaderHeight} />
        )}
        <View style={{ flex: 1 }}>
          <Tabs
            backBehavior="none"
            tabBar={() => null}
            screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
          >
            <Tabs.Screen name="chapters" options={{ title: t("project.chapters") }} />
            <Tabs.Screen name="manuscript" options={{ title: t("project.manuscript") }} />
            <Tabs.Screen name="ciciro" options={{ title: t("project.ciciro") }} />
            <Tabs.Screen name="index" options={{ href: null }} />
          </Tabs>
          {focused ? null : <ManuscriptTabBar projectId={id} />}
        </View>
      </View>
    </AppHeaderHeightContext.Provider>
  );
}
