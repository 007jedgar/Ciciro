import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useProject } from "../../../lib/project";
import { colors, layout } from "../../../lib/theme";

export default function CiciroScreen() {
  const { project, loading, error } = useProject();

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
      <Text style={layout.title}>Ciciro</Text>
      <Text style={layout.body}>
        You talk to one partner: Ciciro, the editor. Chat, drafting, and tool calls still run
        on the hosted app (POST /api/chat). This tab is a placeholder so the phone workspace
        matches Chapters, Manuscript, and Ciciro without embedding a second assistant.
      </Text>
      {project?.logline ? (
        <Text style={[layout.body, { marginTop: 16 }]}>Logline: {project.logline}</Text>
      ) : null}
      {project?.synopsis ? (
        <Text style={[layout.body, { marginTop: 12 }]}>{project.synopsis}</Text>
      ) : null}
    </ScrollView>
  );
}
