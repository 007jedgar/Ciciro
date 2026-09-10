import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api";
import { createManuscript } from "../lib/manuscripts";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import type { ProjectDetail } from "../lib/types";

type Props = {
  defaultAuthor?: string;
  folderId?: string;
  onCreated: (project: ProjectDetail) => void;
};

export function NewManuscriptForm({ defaultAuthor = "", folderId, onCreated }: Props) {
  const { t } = useTranslation();
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
      const project = await createManuscript({
        title,
        author,
        genre,
        ...(folderId ? { folderId } : {}),
      });
      onCreated(project);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("newManuscript.createError"));
      setBusy(false);
    }
  }

  return (
    <View>
      <Text style={[layout.body, { marginBottom: 16 }]}>{t("newManuscript.blurb")}</Text>
      <TextInput
        style={layout.input}
        aria-label={t("newManuscript.titleLabel")}
        placeholder={t("newManuscript.titleLabel")}
        placeholderTextColor={colors.inkSoft}
        value={title}
        onChangeText={setTitle}
        autoCorrect={autoCorrect}
        spellCheck={autoCorrect}
      />
      <TextInput
        style={layout.input}
        aria-label={t("newManuscript.authorLabel")}
        placeholder={t("newManuscript.authorLabel")}
        placeholderTextColor={colors.inkSoft}
        value={author}
        onChangeText={setAuthor}
        autoComplete="name"
        autoCorrect={autoCorrect}
        spellCheck={autoCorrect}
      />
      <TextInput
        style={layout.input}
        aria-label={t("newManuscript.genreLabel")}
        placeholder={t("newManuscript.genrePlaceholder")}
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
        accessibilityLabel={t("newManuscript.submit")}
      >
        <Text style={layout.primaryBtnText}>
          {busy ? t("newManuscript.creating") : t("newManuscript.submit")}
        </Text>
      </Pressable>
    </View>
  );
}
