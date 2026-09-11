import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTabBarClearance } from "../../../components/ManuscriptTabBar";
import { htmlToPlainText } from "../../../lib/html";
import { useProject } from "../../../lib/project";
import { useAppTheme } from "../../../lib/settings";
import { fonts } from "../../../lib/theme";

export default function ManuscriptScreen() {
  const { project, loading, error, selectedChapterId } = useProject();
  const { t } = useTranslation();
  const { layout, colors, settings } = useAppTheme();
  const clearance = useTabBarClearance();
  const chapter = project?.chapters.find((c) => c.id === selectedChapterId) ?? project?.chapters[0];

  if (loading && !project) {
    return (
      <View style={[layout.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={layout.padded}>
        <Text style={layout.error}>{error}</Text>
      </View>
    );
  }

  if (!chapter) {
    return (
      <View style={layout.padded}>
        <Text style={layout.body}>{t("manuscript.noChapters")}</Text>
      </View>
    );
  }

  const body = htmlToPlainText(chapter.content);

  return (
    <ScrollView style={layout.screen} contentContainerStyle={{ padding: 20, paddingBottom: clearance }}>
      <Text style={layout.title}>{chapter.title}</Text>
      {body ? (
        <Text
          style={{
            fontFamily: settings.editorFont === "sans" ? fonts.sans : fonts.serif,
            fontSize: settings.editorFontSize,
            lineHeight: Math.round(settings.editorFontSize * 1.55),
            color: colors.ink,
          }}
        >
          {body}
        </Text>
      ) : (
        <Text style={layout.body}>{t("manuscript.emptyChapter")}</Text>
      )}
    </ScrollView>
  );
}
