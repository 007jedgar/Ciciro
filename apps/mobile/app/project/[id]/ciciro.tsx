import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useProject } from "../../../lib/project";
import { useAppTheme } from "../../../lib/settings";

export default function CiciroScreen() {
  const { project, loading, error } = useProject();
  const { t } = useTranslation();
  const { layout, colors } = useAppTheme();

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

  return (
    <ScrollView style={layout.screen} contentContainerStyle={{ padding: 20 }}>
      <Text style={layout.title}>{t("ciciroTab.title")}</Text>
      <Text style={layout.body}>{t("ciciroTab.placeholder")}</Text>
      {project?.logline ? (
        <Text style={[layout.body, { marginTop: 16 }]}>
          {t("ciciroTab.logline", { logline: project.logline })}
        </Text>
      ) : null}
      {project?.synopsis ? (
        <Text style={[layout.body, { marginTop: 12 }]}>{project.synopsis}</Text>
      ) : null}
    </ScrollView>
  );
}
