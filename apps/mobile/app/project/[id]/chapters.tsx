import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../../lib/api";
import { useProject } from "../../../lib/project";
import { useAppTheme } from "../../../lib/settings";

export default function ChaptersScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    project,
    loading,
    error,
    selectedChapterId,
    setSelectedChapterId,
    addChapter,
  } = useProject();
  const { t } = useTranslation();
  const { layout, colors } = useAppTheme();
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

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

  const chapters = project?.chapters ?? [];

  async function onAddChapter() {
    setAddError(null);
    setAdding(true);
    try {
      await addChapter();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : t("chapters.addError"));
    } finally {
      setAdding(false);
    }
  }

  return (
    <View style={layout.padded}>
      <Pressable
        style={[layout.primaryBtn, { marginBottom: 16 }]}
        onPress={() => void onAddChapter()}
        disabled={adding}
        accessibilityRole="button"
        accessibilityLabel={t("chapters.add")}
      >
        <Text style={layout.primaryBtnText}>{adding ? t("chapters.adding") : t("chapters.add")}</Text>
      </Pressable>
      {addError ? (
        <Text style={layout.error} role="alert">
          {addError}
        </Text>
      ) : null}
      <FlatList
        data={chapters}
        keyExtractor={(item) => item.id}
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
