import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { chapterHeading } from "../lib/chapter-label";
import type { ManuscriptKind } from "../lib/manuscript-kind";
import { useAppTheme } from "../lib/settings";
import { fonts } from "../lib/theme";
import { PencilIcon } from "./icons";
import { TapPressable } from "./TapPressable";

/**
 * Which chapter the page belongs to, and a way to name it. The editor used to
 * show only the manuscript's title, so a writer deep in a chapter could not
 * tell which one it was, and the title typed on the web could not be changed
 * on the phone. One slim line above the page: "CHAPTER 3" and its title (or
 * "Add a title"); tapping turns the title into a field, and leaving it saves.
 */
export function ChapterTitleBar({
  kind,
  number,
  title,
  onRename,
}: {
  kind: ManuscriptKind;
  /** 1-based position of the chapter in the manuscript. */
  number: number;
  title: string;
  onRename: (title: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { colors, settings } = useAppTheme();
  const { heading, custom } = chapterHeading(kind, number, title, (key, opts) => t(key, opts));
  // A journal entry's date and a blog post's title are the title itself; for
  // the rest the number leads and the title is optional.
  const titleIsHeading = kind === "journal" || kind === "blog";
  const shown = titleIsHeading ? (kind === "blog" && !title.trim() ? "" : heading) : (custom ?? "");
  const kicker = titleIsHeading ? null : heading;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(pending ?? shown);
  }, [editing, pending, shown]);

  async function commit() {
    if (saving.current) return;
    const next = draft.trim();
    setEditing(false);
    if (next === shown.trim()) return;
    saving.current = true;
    setError(false);
    setPending(next);
    try {
      await onRename(next);
    } catch {
      setError(true);
      setDraft(shown);
    } finally {
      saving.current = false;
      setPending(null);
    }
  }

  const placeholder = t(
    kind === "blog" ? "chapterTitle.blogPlaceholder" : kind === "journal" ? "chapterTitle.journalPlaceholder" : "chapterTitle.placeholder"
  );
  const displayed = pending ?? shown;
  const label = t("chapterTitle.edit", { title: displayed || heading });

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {kicker ? (
          <Text style={[styles.kicker, { color: colors.inkSoft }]} numberOfLines={1}>
            {kicker.toUpperCase()}
          </Text>
        ) : null}
        {editing ? (
          <TextInput
            autoFocus
            value={draft}
            onChangeText={setDraft}
            onBlur={() => void commit()}
            onSubmitEditing={() => void commit()}
            returnKeyType="done"
            maxLength={120}
            placeholder={placeholder}
            placeholderTextColor={colors.inkSoft}
            aria-label={t("chapterTitle.field")}
            autoCorrect={settings.autoCorrect}
            spellCheck={settings.autoCorrect}
            style={[styles.field, { color: colors.ink, borderBottomColor: colors.accent }]}
          />
        ) : (
          <TapPressable
            onPress={() => setEditing(true)}
            accessibilityRole="button"
            accessibilityLabel={label}
            hitSlop={8}
            style={styles.titleButton}
          >
            <Text
              numberOfLines={1}
              style={[styles.title, { color: displayed ? colors.ink : colors.inkSoft }]}
            >
              {displayed || placeholder}
            </Text>
            <PencilIcon color={colors.inkSoft} size={14} />
          </TapPressable>
        )}
      </View>
      {error ? (
        <Text style={[styles.error, { color: colors.danger }]} role="alert">
          {t("chapterTitle.saveError")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 32 },
  kicker: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.2 },
  titleButton: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32 },
  title: { flexShrink: 1, fontFamily: fonts.uiMedium, fontSize: 15 },
  field: {
    flex: 1,
    fontFamily: fonts.uiMedium,
    fontSize: 15,
    paddingVertical: 4,
    borderBottomWidth: 1,
  },
  error: { fontSize: 12, marginTop: 2 },
});
