import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api/client";
import {
  useBibleIndexQuery,
  useChaptersQuery,
  useCreateKnowledgeFactMutation,
  useKnowledgeFactsQuery,
  usePatchKnowledgeFactMutation,
  useRetireKnowledgeFactMutation,
} from "../lib/api";
import type { Chapter, KnowledgeFact, KnowledgeStance } from "../lib/api/types";
import { bibleFileLabel } from "../lib/bible-files";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import { getAnalytics } from "../lib/analytics-client";
import { SkeletonList } from "./Skeleton";
import { TapPressable } from "./TapPressable";

type Colors = typeof parchmentColors;
type Layout = typeof parchmentLayout;

function sortFacts(facts: KnowledgeFact[]): KnowledgeFact[] {
  return [...facts].sort((a, b) => {
    const ao = a.chapter?.order ?? -1;
    const bo = b.chapter?.order ?? -1;
    if (ao !== bo) return ao - bo;
    return a.fact.localeCompare(b.fact);
  });
}

function groupByCharacter(facts: KnowledgeFact[]): Map<string, KnowledgeFact[]> {
  const groups = new Map<string, KnowledgeFact[]>();
  for (const fact of facts) {
    const list = groups.get(fact.characterPath) ?? [];
    list.push(fact);
    groups.set(fact.characterPath, list);
  }
  return groups;
}

// The who-knows-what ledger, its own screen: pick a character (or see every
// character at once), each fact in chapter order with a stance badge and a
// source-chapter chip. Retired facts stay in a collapsed, struck-through
// section per character rather than disappearing from view.
export function KnowledgeBoard({
  projectId,
  initialCharacterPath,
}: {
  projectId: string;
  initialCharacterPath?: string | null;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const layout = themed?.layout ?? parchmentLayout;

  const [selected, setSelected] = useState(initialCharacterPath ?? "");
  const [addCharacter, setAddCharacter] = useState(initialCharacterPath ?? "");
  const [addStance, setAddStance] = useState<KnowledgeStance>("knows");
  const [addFact, setAddFact] = useState("");
  const [addChapterId, setAddChapterId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFact, setEditFact] = useState("");
  const [editStance, setEditStance] = useState<KnowledgeStance>("knows");
  const [editChapterId, setEditChapterId] = useState("");
  const [expandedRetired, setExpandedRetired] = useState<Record<string, boolean>>({});

  const bibleIndex = useBibleIndexQuery(projectId);
  const characters = useMemo(
    () =>
      (bibleIndex.data ?? [])
        .filter((e) => /^characters\/[^/]+\.md$/.test(e.path))
        .map((e) => e.path),
    [bibleIndex.data]
  );
  const chaptersQuery = useChaptersQuery(projectId);
  const chapters = useMemo(
    () => [...(chaptersQuery.data ?? [])].sort((a, b) => a.order - b.order),
    [chaptersQuery.data]
  );

  const factsQuery = useKnowledgeFactsQuery(projectId, {
    characterPath: selected || undefined,
    includeRetired: true,
  });
  const facts = factsQuery.data?.facts ?? [];

  const createFact = useCreateKnowledgeFactMutation();
  const patchFact = usePatchKnowledgeFactMutation();
  const retireFact = useRetireKnowledgeFactMutation();
  const busy = createFact.isPending || patchFact.isPending || retireFact.isPending;

  useEffect(() => {
    if (!addCharacter && characters.length > 0) setAddCharacter(selected || characters[0]);
  }, [characters, selected, addCharacter]);

  const active = facts.filter((f) => f.status === "active");
  const retired = facts.filter((f) => f.status !== "active");
  const groups = groupByCharacter(active);
  const retiredGroups = groupByCharacter(retired);
  const characterPaths = selected
    ? [selected]
    : [...new Set([...groups.keys(), ...retiredGroups.keys()])].sort((a, b) =>
        bibleFileLabel(a).localeCompare(bibleFileLabel(b))
      );

  async function add() {
    const characterPath = selected || addCharacter;
    if (!characterPath || !addFact.trim()) return;
    setError(null);
    try {
      await createFact.mutateAsync({
        projectId,
        body: {
          characterPath,
          fact: addFact.trim(),
          stance: addStance,
          chapterId: addChapterId || null,
        },
      });
      setAddFact("");
      setAddChapterId("");
      getAnalytics().track("knowledge_fact_added", {});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("bible.knowledge.addError"));
    }
  }

  async function retire(fact: KnowledgeFact) {
    setError(null);
    try {
      await retireFact.mutateAsync({
        projectId,
        factId: fact.id,
        characterPath: fact.characterPath,
      });
      getAnalytics().track("knowledge_fact_retired", {});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("bible.knowledge.retireError"));
    }
  }

  function startEdit(fact: KnowledgeFact) {
    setEditingId(fact.id);
    setEditFact(fact.fact);
    setEditStance(fact.stance);
    setEditChapterId(fact.chapterId ?? "");
  }

  async function saveEdit() {
    if (!editingId || !editFact.trim()) return;
    const fact = facts.find((f) => f.id === editingId);
    if (!fact) return;
    setError(null);
    try {
      await patchFact.mutateAsync({
        projectId,
        factId: editingId,
        characterPath: fact.characterPath,
        body: { fact: editFact.trim(), stance: editStance, chapterId: editChapterId || null },
      });
      setEditingId(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("bible.knowledge.saveError"));
    }
  }

  if (factsQuery.isPending && !factsQuery.data) {
    return (
      <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <SkeletonList count={4} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView
      testID="knowledge-board"
      style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
    >
      <Text style={[layout.body, { marginBottom: 16 }]}>{t("bible.knowledge.blurb")}</Text>
      {error ? (
        <Text style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
          {error}
        </Text>
      ) : null}
      {factsQuery.isError ? (
        <Text style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
          {t("bible.knowledge.loadError")}
        </Text>
      ) : null}

      <ChipRow
        options={[
          { value: "", label: t("bible.knowledge.allCharacters") },
          ...characters.map((p) => ({ value: p, label: bibleFileLabel(p) })),
        ]}
        value={selected}
        onChange={setSelected}
        colors={colors}
      />

      {characterPaths.length === 0 ? (
        <Text style={[layout.body, { marginTop: 12 }]}>{t("bible.knowledge.empty")}</Text>
      ) : (
        characterPaths.map((path) => (
          <View key={path} style={styles.section}>
            {!selected ? (
              <Text style={[styles.sectionTitle, { color: colors.inkSoft }]}>
                {bibleFileLabel(path)}
              </Text>
            ) : null}

            {sortFacts(groups.get(path) ?? []).map((fact) =>
              editingId === fact.id ? (
                <EditRow
                  key={fact.id}
                  fact={editFact}
                  stance={editStance}
                  chapterId={editChapterId}
                  chapters={chapters}
                  colors={colors}
                  layout={layout}
                  busy={busy}
                  onFactChange={setEditFact}
                  onStanceChange={setEditStance}
                  onChapterChange={setEditChapterId}
                  onSave={() => void saveEdit()}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <FactRow
                  key={fact.id}
                  fact={fact}
                  colors={colors}
                  busy={busy}
                  onEdit={() => startEdit(fact)}
                  onRetire={() => void retire(fact)}
                />
              )
            )}

            {(retiredGroups.get(path) ?? []).length > 0 ? (
              <View style={{ marginTop: 4 }}>
                <TapPressable
                  onPress={() =>
                    setExpandedRetired((prev) => ({ ...prev, [path]: !prev[path] }))
                  }
                  accessibilityRole="button"
                >
                  <Text style={[styles.retiredToggle, { color: colors.accent }]}>
                    {expandedRetired[path]
                      ? t("bible.knowledge.hideRetired", {
                          count: (retiredGroups.get(path) ?? []).length,
                        })
                      : t("bible.knowledge.showRetired", {
                          count: (retiredGroups.get(path) ?? []).length,
                        })}
                  </Text>
                </TapPressable>
                {expandedRetired[path]
                  ? sortFacts(retiredGroups.get(path) ?? []).map((fact) => (
                      <RetiredRow key={fact.id} fact={fact} colors={colors} />
                    ))
                  : null}
              </View>
            ) : null}
          </View>
        ))
      )}

      <View style={[styles.addSection, { borderTopColor: colors.line }]}>
        <Text style={[styles.sectionTitle, { color: colors.inkSoft }]}>
          {t("bible.knowledge.addTitle")}
        </Text>
        {!selected ? (
          <ChipRow
            options={characters.map((p) => ({ value: p, label: bibleFileLabel(p) }))}
            value={addCharacter}
            onChange={setAddCharacter}
            colors={colors}
          />
        ) : null}
        <ChipRow
          options={[
            { value: "knows", label: t("bible.knowledge.stanceKnows") },
            { value: "believes", label: t("bible.knowledge.stanceBelieves") },
          ]}
          value={addStance}
          onChange={(v) => setAddStance(v === "believes" ? "believes" : "knows")}
          colors={colors}
        />
        <TextInput
          style={[layout.input, { marginTop: 8 }]}
          placeholder={t("bible.knowledge.factPlaceholder")}
          placeholderTextColor={colors.inkSoft}
          value={addFact}
          onChangeText={setAddFact}
          editable={!busy}
          multiline
        />
        <ChipRow
          options={[
            { value: "", label: t("bible.knowledge.beforeStory") },
            ...chapters.map((c) => ({ value: c.id, label: c.title })),
          ]}
          value={addChapterId}
          onChange={setAddChapterId}
          colors={colors}
        />
        <TapPressable
          onPress={() => void add()}
          disabled={busy || !addFact.trim() || !(selected || addCharacter)}
          style={[
            layout.primaryBtn,
            {
              marginTop: 10,
              opacity: busy || !addFact.trim() || !(selected || addCharacter) ? 0.5 : 1,
            },
          ]}
          accessibilityRole="button"
        >
          <Text style={layout.primaryBtnText}>{t("bible.knowledge.add")}</Text>
        </TapPressable>
      </View>
    </KeyboardAwareScrollView>
  );
}

function ChipRow({
  options,
  value,
  onChange,
  colors,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  colors: Colors;
}) {
  if (options.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipRow}
      contentContainerStyle={styles.chipRowContent}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <TapPressable
            key={opt.value || "__none__"}
            onPress={() => onChange(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.chip,
              {
                borderColor: active ? colors.accent : colors.line,
                backgroundColor: active ? colors.accentSoft : "transparent",
              },
            ]}
          >
            <Text
              style={{
                color: active ? colors.accent : colors.inkSoft,
                fontSize: 13,
                fontWeight: active ? "600" : "400",
              }}
            >
              {opt.label}
            </Text>
          </TapPressable>
        );
      })}
    </ScrollView>
  );
}

function StanceBadge({ stance, colors }: { stance: KnowledgeStance; colors: Colors }) {
  const { t } = useTranslation();
  const color = stance === "knows" ? colors.accent : colors.draft;
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={{ color, fontSize: 11, fontWeight: "600" }}>
        {stance === "knows" ? t("bible.knowledge.stanceKnows") : t("bible.knowledge.stanceBelieves")}
      </Text>
    </View>
  );
}

function ChapterChip({ title, colors }: { title: string | null; colors: Colors }) {
  const { t } = useTranslation();
  return (
    <View style={[styles.pill, { borderColor: colors.line }]}>
      <Text style={{ color: colors.inkSoft, fontSize: 11 }}>
        {title ?? t("bible.knowledge.beforeStory")}
      </Text>
    </View>
  );
}

function FactRow({
  fact,
  colors,
  busy,
  onEdit,
  onRetire,
}: {
  fact: KnowledgeFact;
  colors: Colors;
  busy: boolean;
  onEdit: () => void;
  onRetire: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.factCard, { borderColor: colors.line, backgroundColor: colors.panel }]}>
      <View style={styles.factMeta}>
        <StanceBadge stance={fact.stance} colors={colors} />
        <ChapterChip title={fact.chapter?.title ?? null} colors={colors} />
      </View>
      <Text style={[styles.factText, { color: colors.ink }]}>{fact.fact}</Text>
      <View style={styles.factActions}>
        <TapPressable onPress={onEdit} disabled={busy} accessibilityRole="button">
          <Text style={{ color: colors.accent, fontSize: 13 }}>{t("bible.knowledge.edit")}</Text>
        </TapPressable>
        <TapPressable onPress={onRetire} disabled={busy} accessibilityRole="button">
          <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{t("bible.knowledge.retire")}</Text>
        </TapPressable>
      </View>
    </View>
  );
}

function RetiredRow({ fact, colors }: { fact: KnowledgeFact; colors: Colors }) {
  return (
    <View
      style={[styles.factCard, styles.retiredCard, { borderColor: colors.line, backgroundColor: colors.panel }]}
    >
      <View style={styles.factMeta}>
        <StanceBadge stance={fact.stance} colors={colors} />
        <ChapterChip title={fact.chapter?.title ?? null} colors={colors} />
      </View>
      <Text style={[styles.factText, styles.struck, { color: colors.inkSoft }]}>{fact.fact}</Text>
    </View>
  );
}

function EditRow({
  fact,
  stance,
  chapterId,
  chapters,
  colors,
  layout,
  busy,
  onFactChange,
  onStanceChange,
  onChapterChange,
  onSave,
  onCancel,
}: {
  fact: string;
  stance: KnowledgeStance;
  chapterId: string;
  chapters: Chapter[];
  colors: Colors;
  layout: Layout;
  busy: boolean;
  onFactChange: (value: string) => void;
  onStanceChange: (value: KnowledgeStance) => void;
  onChapterChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.factCard, { borderColor: colors.accent, backgroundColor: colors.panel }]}>
      <ChipRow
        options={[
          { value: "knows", label: t("bible.knowledge.stanceKnows") },
          { value: "believes", label: t("bible.knowledge.stanceBelieves") },
        ]}
        value={stance}
        onChange={(v) => onStanceChange(v === "believes" ? "believes" : "knows")}
        colors={colors}
      />
      <TextInput
        style={[layout.input, { marginTop: 8, marginBottom: 8 }]}
        value={fact}
        onChangeText={onFactChange}
        editable={!busy}
        multiline
      />
      <ChipRow
        options={[
          { value: "", label: t("bible.knowledge.beforeStory") },
          ...chapters.map((c) => ({ value: c.id, label: c.title })),
        ]}
        value={chapterId}
        onChange={onChapterChange}
        colors={colors}
      />
      <View style={[styles.factActions, { marginTop: 8 }]}>
        <TapPressable onPress={onSave} disabled={busy || !fact.trim()} accessibilityRole="button">
          <Text style={{ color: colors.accent, fontSize: 13, fontWeight: "600" }}>
            {t("bible.knowledge.save")}
          </Text>
        </TapPressable>
        <TapPressable onPress={onCancel} disabled={busy} accessibilityRole="button">
          <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{t("bible.knowledge.cancel")}</Text>
        </TapPressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  section: { marginBottom: 18 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  chipRow: { marginBottom: 12 },
  chipRowContent: { gap: 8, paddingRight: 4 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  factCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  retiredCard: { opacity: 0.7 },
  factMeta: { flexDirection: "row", gap: 6, marginBottom: 6 },
  factText: { fontSize: 14, lineHeight: 20 },
  struck: { textDecorationLine: "line-through" },
  factActions: { flexDirection: "row", gap: 16, marginTop: 8 },
  retiredToggle: { fontSize: 13, marginTop: 2, marginBottom: 4 },
  addSection: { borderTopWidth: 1, paddingTop: 14, marginTop: 8 },
});
