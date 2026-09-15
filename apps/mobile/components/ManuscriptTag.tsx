import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors } from "../lib/theme";

/**
 * The manuscript's genre chip. Empty manuscripts get an "Add genre" control
 * rather than a blank slot, so a tag can be created after the book exists.
 */
export function ManuscriptTag({
  genre,
  busy = false,
  error = null,
  onSave,
}: {
  genre: string;
  busy?: boolean;
  error?: string | null;
  onSave: (genre: string) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const autoCorrect = themed?.settings.autoCorrect ?? true;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(genre);
  const committing = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(genre);
  }, [editing, genre]);

  async function commit() {
    if (committing.current) return;
    const next = draft.trim();
    if (next === genre.trim()) {
      setEditing(false);
      setDraft(genre);
      return;
    }
    committing.current = true;
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      /* Parent reports the error; keep the field open. */
    } finally {
      committing.current = false;
    }
  }

  if (editing) {
    return (
      <View style={styles.wrap}>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.panel,
              borderColor: colors.accent,
              color: colors.ink,
            },
          ]}
          accessibilityLabel={t("manuscriptTag.label")}
          placeholder={t("manuscriptTag.placeholder")}
          placeholderTextColor={colors.inkSoft}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => void commit()}
          onBlur={() => void commit()}
          autoCorrect={autoCorrect}
          spellCheck={autoCorrect}
          autoFocus
          editable={!busy}
          returnKeyType="done"
        />
        {error ? (
          <Text style={[styles.error, { color: colors.danger }]} role="alert">
            {error}
          </Text>
        ) : null}
      </View>
    );
  }

  const hasGenre = Boolean(genre.trim());
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          hasGenre
            ? t("manuscriptTag.editA11y", { genre: genre.trim() })
            : t("manuscriptTag.addA11y")
        }
        onPress={() => setEditing(true)}
        disabled={busy}
        style={[
          styles.chip,
          {
            backgroundColor: hasGenre ? colors.accentSoft : colors.panel,
            borderColor: hasGenre ? colors.accent : colors.line,
            borderStyle: hasGenre ? "solid" : "dashed",
            opacity: busy ? 0.6 : 1,
          },
        ]}
      >
        <Text style={[styles.chipText, { color: hasGenre ? colors.accent : colors.inkSoft }]}>
          {hasGenre ? genre.trim() : t("manuscriptTag.add")}
        </Text>
      </Pressable>
      {error ? (
        <Text style={[styles.error, { color: colors.danger }]} role="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  chip: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { fontSize: 13, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  error: { fontSize: 13, marginTop: 6 },
});
