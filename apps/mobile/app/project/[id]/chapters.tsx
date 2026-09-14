import { FlatList, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTabBarClearance } from "../../../components/ManuscriptTabBar";
import { SkeletonList } from "../../../components/Skeleton";
import { useProject } from "../../../lib/project";
import { useAppTheme } from "../../../lib/settings";

export default function ChaptersScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { project, loading, error, selectedChapterId, setSelectedChapterId } = useProject();
  const { t } = useTranslation();
  const { layout, colors } = useAppTheme();
  const clearance = useTabBarClearance();

  if (loading && !project) {
    return (
      <View style={[layout.padded, { paddingTop: 8 }]}>
        <SkeletonList count={6} accessibilityLabel={t("common.loading")} />
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

  const chapters = project?.chapters ?? [];

  return (
    <View style={layout.padded}>
      <FlatList
        data={chapters}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: clearance }}
        ListEmptyComponent={<Text style={layout.body}>{t("chapters.empty")}</Text>}
        renderItem={({ item }) => {
          const selected = item.id === selectedChapterId;
          return (
            <Pressable
              style={[
                layout.card,
                selected ? { borderColor: colors.accent, backgroundColor: colors.accentSoft } : null,
              ]}
              onPress={() => {
                setSelectedChapterId(item.id);
                if (id && !Array.isArray(id)) {
                  router.navigate(`/project/${id}/manuscript`);
                }
              }}
            >
              <Text style={layout.cardTitle}>{item.title}</Text>
              <Text style={layout.cardMeta}>
                {t("chapters.wordCount", { count: item.wordCount })}
                {item.status ? ` · ${item.status}` : ""}
              </Text>
              {item.summary ? <Text style={layout.cardMeta}>{item.summary}</Text> : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}
