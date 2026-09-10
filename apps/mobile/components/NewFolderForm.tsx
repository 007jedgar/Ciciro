import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api";
import { createFolder } from "../lib/folders";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import type { Folder } from "../lib/types";

type Props = {
  onCreated: (folder: Folder) => void;
};

export function NewFolderForm({ onCreated }: Props) {
  const { t } = useTranslation();
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
      setError(t("newFolder.nameRequired"));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const folder = await createFolder({ name, notes });
      onCreated(folder);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("newFolder.createError"));
      setBusy(false);
    }
  }

  return (
    <View>
      <Text style={[layout.body, { marginBottom: 16 }]}>{t("newFolder.blurb")}</Text>
      <TextInput
        style={layout.input}
        aria-label={t("newFolder.nameLabel")}
        placeholder={t("newFolder.nameLabel")}
        placeholderTextColor={colors.inkSoft}
        value={name}
        onChangeText={setName}
        autoCorrect={autoCorrect}
        spellCheck={autoCorrect}
      />
      <TextInput
        style={[layout.input, { minHeight: 88, textAlignVertical: "top" }]}
        aria-label={t("newFolder.notesLabel")}
        placeholder={t("newFolder.notesPlaceholder")}
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
        accessibilityLabel={t("newFolder.submit")}
      >
        <Text style={layout.primaryBtnText}>
          {busy ? t("newFolder.creating") : t("newFolder.submit")}
        </Text>
      </Pressable>
    </View>
  );
}
