import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api/client";
import {
  useBibleIndexQuery,
  useCreateBibleCharacterMutation,
  useCreateBiblePlotMutation,
} from "../lib/api";
import {
  bibleFileLabel,
  groupBibleEntries,
  withCoreBibleFiles,
} from "../lib/bible-files";
import type { BibleEntry } from "../lib/api/types";
import { useOptionalAppTheme } from "../lib/settings";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import { SkeletonList } from "./Skeleton";

const STAGGER_MS = 40;

export function StoryBibleIndex({
  projectId,
  onOpenFile,
}: {
  projectId: string;
  onOpenFile: (path: string) => void;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const layout = themed?.layout ?? parchmentLayout;
  const autoCorrect = themed?.settings.autoCorrect ?? true;
  const reduceMotion = useReduceMotion();
  const index = useBibleIndexQuery(projectId);
  const createCharacter = useCreateBibleCharacterMutation();
  const createPlot = useCreateBiblePlotMutation();
  const [newChar, setNewChar] = useState("");
  const [newPlot, setNewPlot] = useState("");
  const [error, setError] = useState<string | null>(null);

  const grouped = groupBibleEntries(
    withCoreBibleFiles(index.data ?? [], t("bible.emptySummary"))
  );

  async function add(kind: "character" | "plot") {
    const name = (kind === "character" ? newChar : newPlot).trim();
    if (!name) return;
    const pending = kind === "character" ? createCharacter.isPending : createPlot.isPending;
    if (pending) return;
    setError(null);
    try {
      const created =
        kind === "character"
          ? await createCharacter.mutateAsync({ projectId, newCharacter: name })
          : await createPlot.mutateAsync({ projectId, newPlot: name });
      if (kind === "character") setNewChar("");
      else setNewPlot("");
      onOpenFile(created.path);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("bible.saveError"));
    }
  }

  if (index.isPending && !index.data) {
    return (
      <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <SkeletonList count={6} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(260)}>
        <Text style={[layout.body, { marginBottom: 16 }]}>{t("bible.blurb")}</Text>
      </Animated.View>
      {error ? (
        <Text style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
          {error}
        </Text>
      ) : null}
      {index.isError ? (
        <Text style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
          {t("bible.loadError")}
        </Text>
      ) : null}

      <Section title={t("bible.sectionCore")}>
        {grouped.core.map((entry, i) => (
          <FileCard
            key={entry.path}
            entry={entry}
            index={i}
            animate={!reduceMotion}
            onPress={() => onOpenFile(entry.path)}
          />
        ))}
      </Section>

      <Section title={t("bible.sectionCharacters")}>
        {grouped.characters.map((entry, i) => (
          <FileCard
            key={entry.path}
            entry={entry}
            index={i}
            animate={!reduceMotion}
            onPress={() => onOpenFile(entry.path)}
          />
        ))}
        <AddRow
          value={newChar}
          onChange={setNewChar}
          placeholder={t("bible.newCharacter")}
          addLabel={t("bible.addCharacter")}
          busy={createCharacter.isPending}
          autoCorrect={autoCorrect}
          animate={!reduceMotion}
          delayIndex={grouped.characters.length}
          onAdd={() => void add("character")}
        />
      </Section>

      <Section title={t("bible.sectionPlot")}>
        {grouped.plotLines.map((entry, i) => (
          <FileCard
            key={entry.path}
            entry={entry}
            index={i}
            animate={!reduceMotion}
            onPress={() => onOpenFile(entry.path)}
          />
        ))}
        <AddRow
          value={newPlot}
          onChange={setNewPlot}
          placeholder={t("bible.newPlot")}
          addLabel={t("bible.addPlot")}
          busy={createPlot.isPending}
          autoCorrect={autoCorrect}
          animate={!reduceMotion}
          delayIndex={grouped.plotLines.length}
          onAdd={() => void add("plot")}
        />
      </Section>

      {grouped.other.length > 0 ? (
        <Section title={t("bible.sectionOther")}>
          {grouped.other.map((entry, i) => (
            <FileCard
              key={entry.path}
              entry={entry}
              index={i}
              animate={!reduceMotion}
              onPress={() => onOpenFile(entry.path)}
            />
          ))}
        </Section>
      ) : null}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.inkSoft }]}>{title}</Text>
      {children}
    </View>
  );
}

function FileCard({
  entry,
  index,
  animate,
  onPress,
}: {
  entry: BibleEntry;
  index: number;
  animate: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const layout = themed?.layout ?? parchmentLayout;
  const label = bibleFileLabel(entry.path);
  return (
    <Animated.View
      entering={animate ? FadeInDown.duration(260).delay(Math.min(index, 6) * STAGGER_MS) : undefined}
    >
      <Pressable
        style={layout.card}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t("bible.openA11y", { name: label })}
      >
        <Text style={layout.cardTitle}>{label}</Text>
        <Text style={layout.cardMeta}>{entry.summary}</Text>
      </Pressable>
    </Animated.View>
  );
}

function AddRow({
  value,
  onChange,
  placeholder,
  addLabel,
  busy,
  autoCorrect,
  animate,
  delayIndex,
  onAdd,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  addLabel: string;
  busy: boolean;
  autoCorrect: boolean;
  animate: boolean;
  delayIndex: number;
  onAdd: () => void;
}) {
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const disabled = busy || !value.trim();
  return (
    <Animated.View
      entering={animate ? FadeInDown.duration(260).delay(Math.min(delayIndex, 6) * STAGGER_MS) : undefined}
      style={styles.addRow}
    >
      <TextInput
        style={[
          styles.input,
          { backgroundColor: colors.panel, borderColor: colors.line, color: colors.ink },
        ]}
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        placeholderTextColor={colors.inkSoft}
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onAdd}
        autoCorrect={autoCorrect}
        spellCheck={autoCorrect}
        returnKeyType="done"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={addLabel}
        onPress={onAdd}
        disabled={disabled}
        style={[
          styles.addBtn,
          { backgroundColor: colors.accent, opacity: disabled ? 0.5 : 1 },
        ]}
      >
        <Text style={[styles.addBtnText, { color: colors.panel }]}>{addLabel}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 4 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  addBtn: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  addBtnText: { fontSize: 15, fontWeight: "600" },
});
