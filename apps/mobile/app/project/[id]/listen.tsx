import { Redirect, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import Animated, { Easing, FadeInDown, FadeIn } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../../components/AppHeader";
import { ReadAloud } from "../../../components/ReadAloud";
import { SkeletonList } from "../../../components/Skeleton";
import { readAloudSelectionFor } from "../../../lib/read-aloud";
import { blocksPlainText } from "../../../lib/read-aloud-text";
import { useProject } from "../../../lib/project";
import { useSession } from "../../../lib/session";
import { useAppTheme } from "../../../lib/settings";
import { useReduceMotion } from "../../../lib/use-reduce-motion";
import { useStackBack } from "../../../lib/use-stack-back";

function ListenBody() {
  const { t } = useTranslation();
  const { layout } = useAppTheme();
  const { project, loading, error, selectedChapterId } = useProject();
  const chapter = project?.chapters.find((c) => c.id === selectedChapterId) ?? project?.chapters[0];

  if (loading && !project) {
    return (
      <View style={[layout.padded, { paddingTop: 8 }]}>
        <SkeletonList count={5} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={[layout.padded, { paddingTop: 16 }]}>
        <Text style={layout.error}>{error}</Text>
      </View>
    );
  }
  if (!chapter) {
    return (
      <View style={[layout.padded, { paddingTop: 16 }]}>
        <Text style={layout.body}>{t("manuscript.noChapters")}</Text>
      </View>
    );
  }
  const selection = readAloudSelectionFor(chapter.id, blocksPlainText(chapter.content));
  return (
    <View style={[layout.padded, { paddingTop: 8, flex: 1 }]}>
      <ReadAloud
        header={<Text style={[layout.cardTitle, { marginBottom: 8 }]}>{chapter.title}</Text>}
        chapterId={chapter.id}
        html={chapter.content}
        selection={selection}
      />
    </View>
  );
}

export default function ListenScreen() {
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, ready } = useSession();
  const { layout } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const projectId = typeof id === "string" ? id : "";

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (!projectId) return <Redirect href="/manuscripts" />;

  return (
    // The route is presented without a native transition, so the screen rises
    // in itself; a plain fade when motion is reduced.
    <Animated.View
      style={layout.screen}
      entering={
        reduceMotion
          ? FadeIn.duration(140)
          : FadeInDown.duration(320).easing(Easing.bezier(0.16, 1, 0.3, 1)).withInitialValues({
              opacity: 0,
              transform: [{ translateY: 32 }],
            })
      }
    >
      <AppHeader
        title={t("readAloud.title")}
        onBack={() => backOr(`/project/${projectId}/manuscript`)}
        backAccessibilityLabel={t("bible.backToManuscript")}
      />
      <ListenBody />
    </Animated.View>
  );
}
