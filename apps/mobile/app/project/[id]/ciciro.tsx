import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTabBarClearance } from "../../../components/ManuscriptTabBar";
import { SkeletonList } from "../../../components/Skeleton";
import { useProject } from "../../../lib/project";
import { useAppTheme } from "../../../lib/settings";

const INTENTS = ["continue", "rewrite", "describe"] as const;
type Intent = (typeof INTENTS)[number];

function asIntent(value: string | string[] | undefined): Intent | null {
  const first = Array.isArray(value) ? value[0] : value;
  return INTENTS.includes(first as Intent) ? (first as Intent) : null;
}

export default function CiciroScreen() {
  const { project, loading, error } = useProject();
  const { intent } = useLocalSearchParams<{ intent?: string }>();
  const { t } = useTranslation();
  const { layout, colors } = useAppTheme();
  const clearance = useTabBarClearance();
  const requested = asIntent(intent);

  if (loading && !project) {
    return (
      <View style={[layout.padded, { paddingTop: 8 }]}>
        <SkeletonList count={4} accessibilityLabel={t("common.loading")} />
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
    <ScrollView style={layout.screen} contentContainerStyle={{ padding: 20, paddingBottom: clearance }}>
      <Text style={layout.title}>{t("ciciroTab.title")}</Text>
      {requested ? (
        <View
          style={{
            marginBottom: 16,
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.accentSoft,
          }}
        >
          <Text style={{ color: colors.inkSoft, fontSize: 12, marginBottom: 2 }}>
            {t("ciciroTab.requested")}
          </Text>
          <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "600" }}>
            {t(`ciciroTab.intent.${requested}`)}
          </Text>
        </View>
      ) : null}
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
