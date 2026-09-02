import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { htmlToPlainText } from "../../../lib/html";
import { useProject } from "../../../lib/project";
import { colors, fonts, layout } from "../../../lib/theme";

export default function ManuscriptScreen() {
  const { project, loading, error, selectedChapterId } = useProject();
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
        <Text style={layout.body}>This manuscript has no chapters yet.</Text>
      </View>
    );
  }

  const body = htmlToPlainText(chapter.content);

  return (
    <ScrollView style={layout.screen} contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
      <Text style={[layout.cardMeta, { marginBottom: 4 }]}>{project?.title}</Text>
      <Text style={layout.title}>{chapter.title}</Text>
      {body ? (
        <Text
          style={{
            fontFamily: fonts.serif,
            fontSize: 18,
            lineHeight: 28,
            color: colors.ink,
          }}
        >
          {body}
        </Text>
      ) : (
        <Text style={layout.body}>This chapter is empty. Write it on the hosted web editor.</Text>
      )}
    </ScrollView>
  );
}
