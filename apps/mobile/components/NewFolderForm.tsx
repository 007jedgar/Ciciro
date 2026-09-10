import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ApiError } from "../lib/api";
import { createFolder } from "../lib/folders";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import type { Folder } from "../lib/types";

type Props = {
  onCreated: (folder: Folder) => void;
};

export function NewFolderForm({ onCreated }: Props) {
  const themed = useOptionalAppTheme();
  const layout = themed?.layout ?? parchmentLayout;
  const colors = themed?.colors ?? parchmentColors;
  const autoCorrect = themed?.settings.autoCorrect ?? true;
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const folder = await createFolder({ name, notes });
      onCreated(folder);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create folder.");
      setBusy(false);
    }
  }

  return (
    <View>
      <Text style={[layout.body, { marginBottom: 16 }]}>
        Group manuscripts that belong together. Deleting a folder later leaves the books in your
        library.
      </Text>
      <TextInput
        style={layout.input}
        aria-label="Folder name"
        placeholder="Folder name"
        placeholderTextColor={colors.inkSoft}
        value={name}
        onChangeText={setName}
        autoCorrect={autoCorrect}
        spellCheck={autoCorrect}
      />
      <TextInput
        style={[layout.input, { minHeight: 88, textAlignVertical: "top" }]}
        aria-label="Notes"
        placeholder="Notes (optional)"
        placeholderTextColor={colors.inkSoft}
        value={notes}
        onChangeText={setNotes}
        multiline
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
        accessibilityLabel="Create folder"
      >
        <Text style={layout.primaryBtnText}>{busy ? "Creating..." : "Create folder"}</Text>
      </Pressable>
    </View>
  );
}
