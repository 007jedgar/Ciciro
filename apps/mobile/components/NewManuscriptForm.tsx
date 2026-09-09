import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ApiError } from "../lib/api";
import { createManuscript } from "../lib/manuscripts";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import type { ProjectDetail } from "../lib/types";

type Props = {
  defaultAuthor?: string;
  onCreated: (project: ProjectDetail) => void;
};

export function NewManuscriptForm({ defaultAuthor = "", onCreated }: Props) {
  const themed = useOptionalAppTheme();
  const layout = themed?.layout ?? parchmentLayout;
  const colors = themed?.colors ?? parchmentColors;
  const autoCorrect = themed?.settings.autoCorrect ?? true;
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState(defaultAuthor);
  const [genre, setGenre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const project = await createManuscript({ title, author, genre });
      onCreated(project);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create manuscript.");
      setBusy(false);
    }
  }

  return (
    <View>
      <Text style={layout.title}>Start a new manuscript</Text>
      <Text style={[layout.body, { marginBottom: 16 }]}>
        Same as the web app: a title, an author, and an optional genre. Ciciro opens Chapter 1.
      </Text>
      <TextInput
        style={layout.input}
        aria-label="Title"
        placeholder="Title"
        placeholderTextColor={colors.inkSoft}
        value={title}
        onChangeText={setTitle}
        autoCorrect={autoCorrect}
        spellCheck={autoCorrect}
      />
      <TextInput
        style={layout.input}
        aria-label="Author name"
        placeholder="Author name"
        placeholderTextColor={colors.inkSoft}
        value={author}
        onChangeText={setAuthor}
        autoComplete="name"
        autoCorrect={autoCorrect}
        spellCheck={autoCorrect}
      />
      <TextInput
        style={layout.input}
        aria-label="Genre"
        placeholder="Genre (optional)"
        placeholderTextColor={colors.inkSoft}
        value={genre}
        onChangeText={setGenre}
        autoCorrect={autoCorrect}
        spellCheck={autoCorrect}
      />
      {error ? (
        <Text style={layout.error} role="alert">
          {error}
        </Text>
      ) : null}
      <Pressable
        style={layout.primaryBtn}
        onPress={() => void submit()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Create manuscript"
      >
        <Text style={layout.primaryBtnText}>{busy ? "Creating..." : "Create manuscript"}</Text>
      </Pressable>
    </View>
  );
}
