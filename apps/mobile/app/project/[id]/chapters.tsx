import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useProject } from "../../../lib/project";
import { colors, layout } from "../../../lib/theme";

export default function ChaptersScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { project, loading, error, selectedChapterId, setSelectedChapterId } = useProject();

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

  return (
    <View style={layout.padded}>
      <Text style={layout.title}>{project?.title || "Untitled Manuscript"}</Text>
      <FlatList
        data={chapters}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={layout.body}>No chapters yet.</Text>}
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
                {item.wordCount} words
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
