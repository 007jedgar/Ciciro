import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api";
import { createManuscript } from "../lib/manuscripts";
import { MANUSCRIPT_KINDS, type ManuscriptKind } from "../lib/manuscript-kind";
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
  const [kind, setKind] = useState<ManuscriptKind>("novel");
  const [subtitle, setSubtitle] = useState("");
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
        genre: kind === "journal" ? "" : genre,
        ...(kind !== "novel" ? { kind } : {}),
        ...(kind === "blog" && subtitle.trim() ? { logline: subtitle } : {}),
        ...(folderId ? { folderId } : {}),
      });
      onCreated(project);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("newManuscript.createError"));
      setBusy(false);
    }
  }

  const submitLabel =
    kind === "novel"
      ? t("newManuscript.submit")
      : t("kinds.create", { kind: t(`kinds.${kind}.label`).toLowerCase() });

  return (
    <View>
      <Text style={[layout.body, { marginBottom: 16 }]}>{t("newManuscript.blurb")}</Text>
      <Text style={[layout.cardMeta, { marginBottom: 8 }]}>{t("kinds.question")}</Text>
      <View
        accessibilityRole="radiogroup"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}
      >
        {MANUSCRIPT_KINDS.map((option) => {
          const selected = kind === option;
          return (
            <Pressable
              key={option}
              onPress={() => setKind(option)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={t(`kinds.${option}.label`)}
              style={[
                layout.card,
                {
                  flexBasis: "47%",
                  flexGrow: 1,
                  marginBottom: 0,
                  borderColor: selected ? colors.accent : colors.line,
                  backgroundColor: selected ? colors.accentSoft : undefined,
                },
              ]}
            >
              <Text style={layout.cardTitle}>{t(`kinds.${option}.label`)}</Text>
              <Text style={layout.cardMeta}>{t(`kinds.${option}.description`)}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        style={layout.input}
        aria-label={t("newManuscript.titleLabel")}
        placeholder={
          kind === "journal" ? t("kinds.journalTitlePlaceholder") : t("newManuscript.titleLabel")
        }
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
      {kind === "blog" ? (
        <TextInput
          style={layout.input}
          aria-label={t("kinds.subtitleLabel")}
          placeholder={t("kinds.subtitlePlaceholder")}
          placeholderTextColor={colors.inkSoft}
          value={subtitle}
          onChangeText={setSubtitle}
          autoCorrect={autoCorrect}
          spellCheck={autoCorrect}
        />
      ) : null}
      {kind !== "journal" ? (
        <TextInput
          style={layout.input}
          aria-label={t("newManuscript.genreLabel")}
          placeholder={
            kind === "blog" ? t("kinds.blogGenrePlaceholder") : t("newManuscript.genrePlaceholder")
          }
          placeholderTextColor={colors.inkSoft}
          value={genre}
          onChangeText={setGenre}
          autoCorrect={autoCorrect}
          spellCheck={autoCorrect}
        />
      ) : null}
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
        accessibilityLabel={submitLabel}
      >
        <Text style={layout.primaryBtnText}>
          {busy ? t("newManuscript.creating") : submitLabel}
        </Text>
      </Pressable>
    </View>
  );
}
