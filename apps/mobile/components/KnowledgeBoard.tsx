import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api/client";
import {
  useBibleFileQuery,
  useBibleIndexQuery,
  useChaptersQuery,
  useCreateKnowledgeFactMutation,
  useKnowledgeFactsQuery,
  usePatchKnowledgeFactMutation,
  useRetireKnowledgeFactMutation,
} from "../lib/api";
import type { Chapter, KnowledgeFact, KnowledgeStance } from "../lib/api/types";
import { bibleFileLabel } from "../lib/bible-files";
import {
  BEFORE_STORY_ORDER,
  KNOWLEDGE_STANCES,
  anchorOrder,
  byStoryOrder,
  characterTimeline,
  gridCellKey,
  knowledgeGrid,
  parseKnowledgeStance,
  readerNoteFor,
  type LedgerChapter,
} from "../lib/knowledge-ledger";
import { PRESS_SCALE } from "../lib/motion";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import { getAnalytics } from "../lib/analytics-client";
import { ChapterScrubber } from "./ChapterScrubber";
import { SkeletonList } from "./Skeleton";
import { SelectChip, SelectLabel } from "./SelectChip";
import { TapPressable } from "./TapPressable";
import { AlertText } from "./AlertText";

type Colors = typeof parchmentColors;
type Layout = typeof parchmentLayout;
type View_ = "timeline" | "grid";

const STANCE_KEYS: Record<KnowledgeStance, string> = {
  knows: "bible.knowledge.stanceKnows",
  suspects: "bible.knowledge.stanceSuspects",
  believes_wrong: "bible.knowledge.stanceBelievesWrong",
  unaware: "bible.knowledge.stanceUnaware",
};

// The who-knows-what ledger, its own screen. The scrubber picks a point in
// the story; the timeline shows each character's facts in chapter order as
// they stand by the end of that chapter (holding, already over, or still to
// come), and the grid lines characters up on shared topics. Retiring a fact
// stops it at the chapter in view, so earlier chapters keep it.
export function KnowledgeBoard({
  projectId,
  activeChapterId,
  initialCharacterPath,
}: {
  projectId: string;
  /** The chapter the author has open: where the scrubber starts. */
  activeChapterId?: string | null;
  initialCharacterPath?: string | null;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const layout = themed?.layout ?? parchmentLayout;

  const [selected, setSelected] = useState(initialCharacterPath ?? "");
  const [view, setView] = useState<View_>("timeline");
  // Null follows the open chapter until the author scrubs.
  const [chosenStop, setChosenStop] = useState<number | null>(null);
  const scrubbed = useRef(false);

  const [addCharacter, setAddCharacter] = useState(initialCharacterPath ?? "");
  const [addStance, setAddStance] = useState<KnowledgeStance>("knows");
  const [addFact, setAddFact] = useState("");
  const [addTopic, setAddTopic] = useState("");
  const [addChapterChoice, setAddChapterChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFact, setEditFact] = useState("");
  const [editStance, setEditStance] = useState<KnowledgeStance>("knows");
  const [editChapterId, setEditChapterId] = useState("");
  const [editTopic, setEditTopic] = useState("");

  const [changingId, setChangingId] = useState<string | null>(null);
  const [changeFact, setChangeFact] = useState("");
  const [changeStance, setChangeStance] = useState<KnowledgeStance>("knows");
  const [changeTopic, setChangeTopic] = useState("");

  const [expandedRetired, setExpandedRetired] = useState<Record<string, boolean>>({});
  const [showReader, setShowReader] = useState(false);

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
  const canonQuery = useBibleFileQuery(projectId, "canon.md", { enabled: showReader });

  // Every character's facts, retired ones too: the scrubber reads history.
  const factsQuery = useKnowledgeFactsQuery(projectId, { includeRetired: true });
  const facts = useMemo(() => factsQuery.data?.facts ?? [], [factsQuery.data]);

  const createFact = useCreateKnowledgeFactMutation();
  const patchFact = usePatchKnowledgeFactMutation();
  const retireFact = useRetireKnowledgeFactMutation();
  const busy = createFact.isPending || patchFact.isPending || retireFact.isPending;

  useEffect(() => {
    if (!addCharacter && characters.length > 0) setAddCharacter(selected || characters[0]);
  }, [characters, selected, addCharacter]);

  const openIndex = chapters.findIndex((c) => c.id === activeChapterId);
  const defaultStop = openIndex === -1 ? chapters.length : openIndex + 1;
  const stop = Math.min(chosenStop ?? defaultStop, chapters.length);
  const atChapter: Chapter | null = stop > 0 ? chapters[stop - 1] ?? null : null;
  const asOfOrder = atChapter ? atChapter.order : BEFORE_STORY_ORDER;
  const addChapterId = addChapterChoice ?? atChapter?.id ?? "";

  function scrubTo(next: number) {
    setChosenStop(next);
    if (!scrubbed.current) {
      scrubbed.current = true;
      getAnalytics().track("knowledge_scrubber_used", {});
    }
  }

  const numberOf = (chapter: LedgerChapter | null) => {
    if (!chapter) return null;
    const index = chapters.findIndex((c) => c.id === chapter.id);
    return index === -1 ? null : index + 1;
  };
  const fromLabel = (chapter: LedgerChapter | null) => {
    const n = numberOf(chapter);
    if (!chapter) return t("bible.knowledge.beforeStory");
    return n ? t("bible.knowledge.fromChapter", { number: n }) : chapter.title;
  };
  const untilLabel = (chapter: LedgerChapter) => {
    const n = numberOf(chapter);
    return n ? t("bible.knowledge.untilChapter", { number: n }) : chapter.title;
  };
  const stanceLabel = (stance: KnowledgeStance) => t(STANCE_KEYS[stance]);

  const byCharacter = useMemo(() => {
    const groups = new Map<string, KnowledgeFact[]>();
    for (const fact of facts) {
      const list = groups.get(fact.characterPath) ?? [];
      list.push(fact);
      groups.set(fact.characterPath, list);
    }
    return groups;
  }, [facts]);

  const characterPaths = selected
    ? [selected]
    : [...byCharacter.keys()].sort((a, b) => bibleFileLabel(a).localeCompare(bibleFileLabel(b)));

  const topics = useMemo(() => {
    const seen = new Map<string, string>();
    for (const fact of facts) {
      const label = fact.topic?.trim();
      if (label && !seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [facts]);

  const grid = useMemo(() => knowledgeGrid(facts, asOfOrder), [facts, asOfOrder]);

  const asOfLabel = atChapter
    ? t("bible.knowledge.asOfChapter", { number: stop, title: atChapter.title })
    : t("bible.knowledge.beforeStory");

  const stanceOptions = KNOWLEDGE_STANCES.map((stance) => ({ value: stance, label: stanceLabel(stance) }));
  const chapterOptions = [
    { value: "", label: t("bible.knowledge.beforeStory") },
    ...chapters.map((c, i) => ({ value: c.id, label: `${i + 1}. ${c.title}` })),
  ];

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
          topic: addTopic.trim() || null,
          chapterId: addChapterId || null,
        },
      });
      setAddFact("");
      setAddTopic("");
      setAddChapterChoice(null);
      getAnalytics().track("knowledge_fact_added", {});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("bible.knowledge.addError"));
    }
  }

  const stopsHere = (fact: KnowledgeFact) => Boolean(atChapter && asOfOrder > anchorOrder(fact));

  async function retire(fact: KnowledgeFact) {
    setError(null);
    try {
      await retireFact.mutateAsync({
        projectId,
        factId: fact.id,
        characterPath: fact.characterPath,
        asOfChapterId: stopsHere(fact) ? atChapter?.id : null,
      });
      getAnalytics().track("knowledge_fact_retired", {});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("bible.knowledge.retireError"));
    }
  }

  function startEdit(fact: KnowledgeFact) {
    setChangingId(null);
    setEditingId(fact.id);
    setEditFact(fact.fact);
    setEditStance(fact.stance);
    setEditChapterId(fact.chapterId ?? "");
    setEditTopic(fact.topic ?? "");
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
        body: {
          fact: editFact.trim(),
          stance: editStance,
          chapterId: editChapterId || null,
          topic: editTopic.trim() || null,
        },
      });
      setEditingId(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("bible.knowledge.saveError"));
    }
  }

  function startChange(fact: KnowledgeFact) {
    setEditingId(null);
    setChangingId(fact.id);
    setChangeFact(fact.fact);
    setChangeStance(fact.stance);
    setChangeTopic(fact.topic ?? "");
  }

  async function saveChange(fact: KnowledgeFact) {
    if (!atChapter || !changeFact.trim()) return;
    setError(null);
    try {
      await createFact.mutateAsync({
        projectId,
        body: {
          characterPath: fact.characterPath,
          fact: changeFact.trim(),
          stance: changeStance,
          topic: changeTopic.trim() || null,
          chapterId: atChapter.id,
          replacesFactId: fact.id,
        },
      });
      setChangingId(null);
      getAnalytics().track("knowledge_fact_replaced", {});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("bible.knowledge.changeError"));
    }
  }

  if (factsQuery.isPending && !factsQuery.data) {
    return (
      <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <SkeletonList count={4} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }

  function editCard(fact: KnowledgeFact) {
    return (
      <View key={fact.id} style={[styles.factCard, { borderColor: colors.accent, backgroundColor: colors.panel }]}>
        <ChipRow options={stanceOptions} value={editStance} onChange={(v) => setEditStance(parseKnowledgeStance(v) ?? "knows")} colors={colors} />
        <TextInput
          style={[layout.input, { marginBottom: 8 }]}
          accessibilityLabel={t("bible.knowledge.factPlaceholder")}
          value={editFact}
          onChangeText={setEditFact}
          editable={!busy}
          multiline
        />
        <TopicField
          value={editTopic}
          onChange={setEditTopic}
          topics={topics}
          colors={colors}
          layout={layout}
          busy={busy}
        />
        <ChipRow options={chapterOptions} value={editChapterId} onChange={setEditChapterId} colors={colors} />
        <View style={styles.factActions}>
          <TapPressable onPress={() => void saveEdit()} disabled={busy || !editFact.trim()} accessibilityRole="button" feedback="dim">
            <Text style={[styles.action, { color: colors.accent, fontWeight: "600" }]}>{t("bible.knowledge.save")}</Text>
          </TapPressable>
          <TapPressable onPress={() => setEditingId(null)} disabled={busy} accessibilityRole="button" feedback="dim">
            <Text style={[styles.action, { color: colors.inkSoft }]}>{t("bible.knowledge.cancel")}</Text>
          </TapPressable>
        </View>
      </View>
    );
  }

  function changeCard(fact: KnowledgeFact) {
    return (
      <View key={fact.id} style={[styles.factCard, { borderColor: colors.accent, backgroundColor: colors.panel }]}>
        <Text style={[styles.changeHead, { color: colors.ink }]}>
          {t("bible.knowledge.changeHead", { number: stop, name: bibleFileLabel(fact.characterPath) })}
        </Text>
        <ChipRow options={stanceOptions} value={changeStance} onChange={(v) => setChangeStance(parseKnowledgeStance(v) ?? "knows")} colors={colors} />
        <TextInput
          style={[layout.input, { marginBottom: 8 }]}
          accessibilityLabel={t("bible.knowledge.factPlaceholder")}
          value={changeFact}
          onChangeText={setChangeFact}
          editable={!busy}
          multiline
        />
        <TopicField
          value={changeTopic}
          onChange={setChangeTopic}
          topics={topics}
          colors={colors}
          layout={layout}
          busy={busy}
        />
        <View style={styles.factActions}>
          <TapPressable onPress={() => void saveChange(fact)} disabled={busy || !changeFact.trim()} accessibilityRole="button" feedback="dim">
            <Text style={[styles.action, { color: colors.accent, fontWeight: "600" }]}>
              {t("bible.knowledge.saveChange")}
            </Text>
          </TapPressable>
          <TapPressable onPress={() => setChangingId(null)} disabled={busy} accessibilityRole="button" feedback="dim">
            <Text style={[styles.action, { color: colors.inkSoft }]}>{t("bible.knowledge.cancel")}</Text>
          </TapPressable>
        </View>
      </View>
    );
  }

  function timelineFor(path: string) {
    const all = byCharacter.get(path) ?? [];
    const rows = characterTimeline(all, asOfOrder);
    const now = rows.filter((row) => row.state !== "later");
    const later = rows.filter((row) => row.state === "later");
    const retiredEverywhere = all.filter((f) => f.status !== "active" && !f.supersededAtChapter).sort(byStoryOrder);
    return (
      <View key={path} style={styles.section}>
        {!selected ? (
          <Text style={[styles.sectionTitle, { color: colors.inkSoft }]}>{bibleFileLabel(path)}</Text>
        ) : null}
        {now.length === 0 ? (
          <Text style={[styles.none, { color: colors.inkSoft }]}>{t("bible.knowledge.nothingYet")}</Text>
        ) : null}
        {now.map(({ fact, state, replacedBy }) => {
          if (editingId === fact.id) return editCard(fact);
          if (changingId === fact.id) return changeCard(fact);
          const ended = state === "ended";
          return (
            <View
              key={fact.id}
              testID={`knowledge-fact-${fact.id}`}
              style={[styles.factCard, { borderColor: colors.line, backgroundColor: colors.panel }]}
            >
              <View style={styles.factMeta}>
                <StanceBadge stance={fact.stance} label={stanceLabel(fact.stance)} colors={colors} />
                <Pill text={fromLabel(fact.chapter)} colors={colors} />
                {ended && fact.supersededAtChapter ? <Pill text={untilLabel(fact.supersededAtChapter)} colors={colors} /> : null}
                {fact.topic ? <Pill text={fact.topic} colors={colors} italic /> : null}
              </View>
              <Text style={[styles.factText, { color: ended ? colors.inkSoft : colors.ink }, ended && styles.struck]}>
                {fact.fact}
              </Text>
              {ended && replacedBy ? (
                <Text style={[styles.lineage, { color: colors.inkSoft }]}>
                  {"→ "}
                  {t("bible.knowledge.thenStance", { stance: stanceLabel(replacedBy.stance), fact: replacedBy.fact })}
                </Text>
              ) : null}
              {state === "in_effect" ? (
                <View style={styles.factActions}>
                  <TapPressable onPress={() => startEdit(fact)} disabled={busy} accessibilityRole="button" feedback="dim">
                    <Text style={[styles.action, { color: colors.accent }]}>{t("bible.knowledge.edit")}</Text>
                  </TapPressable>
                  {stopsHere(fact) ? (
                    <TapPressable onPress={() => startChange(fact)} disabled={busy} accessibilityRole="button" feedback="dim">
                      <Text style={[styles.action, { color: colors.accent }]}>{t("bible.knowledge.changesHere")}</Text>
                    </TapPressable>
                  ) : null}
                  <TapPressable onPress={() => void retire(fact)} disabled={busy} accessibilityRole="button" feedback="dim">
                    <Text style={[styles.action, { color: colors.inkSoft }]}>
                      {stopsHere(fact) ? t("bible.knowledge.stopsHere") : t("bible.knowledge.retire")}
                    </Text>
                  </TapPressable>
                </View>
              ) : null}
            </View>
          );
        })}

        {later.length > 0 ? (
          <>
            <Text style={[styles.divider, { color: colors.inkSoft, borderTopColor: colors.line }]}>
              {t("bible.knowledge.laterInStory")}
            </Text>
            {later.map(({ fact }) =>
              editingId === fact.id ? (
                editCard(fact)
              ) : (
                <View
                  key={fact.id}
                  testID={`knowledge-fact-${fact.id}`}
                  style={[styles.factCard, styles.laterCard, { borderColor: colors.line, backgroundColor: colors.panel }]}
                >
                  <View style={styles.factMeta}>
                    <StanceBadge stance={fact.stance} label={stanceLabel(fact.stance)} colors={colors} />
                    <Pill text={fromLabel(fact.chapter)} colors={colors} />
                    {fact.topic ? <Pill text={fact.topic} colors={colors} italic /> : null}
                  </View>
                  <Text style={[styles.factText, { color: colors.ink }]}>{fact.fact}</Text>
                  <View style={styles.factActions}>
                    <TapPressable onPress={() => startEdit(fact)} disabled={busy} accessibilityRole="button" feedback="dim">
                      <Text style={[styles.action, { color: colors.accent }]}>{t("bible.knowledge.edit")}</Text>
                    </TapPressable>
                  </View>
                </View>
              )
            )}
          </>
        ) : null}

        {retiredEverywhere.length > 0 ? (
          <View style={{ marginTop: 4 }}>
            <TapPressable
              onPress={() => setExpandedRetired((prev) => ({ ...prev, [path]: !prev[path] }))}
              accessibilityRole="button"
              feedback="dim"
            >
              <Text style={[styles.retiredToggle, { color: colors.accent }]}>
                {expandedRetired[path]
                  ? t("bible.knowledge.hideRetired", { count: retiredEverywhere.length })
                  : t("bible.knowledge.showRetired", { count: retiredEverywhere.length })}
              </Text>
            </TapPressable>
            {expandedRetired[path]
              ? retiredEverywhere.map((fact) => (
                  <View
                    key={fact.id}
                    style={[styles.factCard, styles.laterCard, { borderColor: colors.line, backgroundColor: colors.panel }]}
                  >
                    <View style={styles.factMeta}>
                      <StanceBadge stance={fact.stance} label={stanceLabel(fact.stance)} colors={colors} />
                      <Pill text={fromLabel(fact.chapter)} colors={colors} />
                    </View>
                    <Text style={[styles.factText, styles.struck, { color: colors.inkSoft }]}>{fact.fact}</Text>
                  </View>
                ))
              : null}
          </View>
        ) : null}
      </View>
    );
  }

  function gridView() {
    if (grid.topics.length === 0) {
      return <Text style={[layout.body, { marginTop: 4 }]}>{t("bible.knowledge.gridEmpty")}</Text>;
    }
    const canon = canonQuery.data?.content ?? "";
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 8 }}>
        <View>
          <View style={[styles.gridRow, { borderBottomColor: colors.line }]}>
            <Text style={[styles.gridHead, styles.gridTopic, { color: colors.inkSoft }]}>{t("bible.knowledge.topicHeader")}</Text>
            {grid.characters.map((path) => (
              <Text key={path} style={[styles.gridHead, styles.gridCell, { color: colors.inkSoft }]} numberOfLines={1}>
                {bibleFileLabel(path)}
              </Text>
            ))}
            {showReader ? (
              <Text style={[styles.gridHead, styles.gridCell, { color: colors.inkSoft }]}>{t("bible.knowledge.readerHeader")}</Text>
            ) : null}
          </View>
          {grid.topics.map((topic) => (
            <View key={topic.key} style={[styles.gridRow, { borderBottomColor: colors.line }]}>
              <Text style={[styles.gridTopic, styles.gridTopicText, { color: colors.ink }]}>{topic.label}</Text>
              {grid.characters.map((path) => {
                const fact = grid.cells.get(gridCellKey(topic.label, path));
                return fact ? (
                  <TapPressable
                    key={path}
                    style={styles.gridCell}
                    scale={PRESS_SCALE.card}
                    accessibilityRole="button"
                    accessibilityLabel={`${bibleFileLabel(path)} ${stanceLabel(fact.stance)}: ${fact.fact}`}
                    onPress={() => {
                      setSelected(path);
                      setView("timeline");
                    }}
                  >
                    <StanceBadge stance={fact.stance} label={stanceLabel(fact.stance)} colors={colors} />
                    <Text style={[styles.gridFact, { color: colors.inkSoft }]} numberOfLines={3}>
                      {fact.fact}
                    </Text>
                  </TapPressable>
                ) : (
                  <Text
                    key={path}
                    style={[styles.gridCell, { color: colors.inkSoft }]}
                    accessibilityLabel={t("bible.knowledge.nothingRecorded")}
                  >
                    ·
                  </Text>
                );
              })}
              {showReader ? (
                <Text style={[styles.gridCell, styles.gridFact, { color: colors.inkSoft }]} numberOfLines={4}>
                  {canonQuery.isPending ? "…" : readerNoteFor(topic.label, canon) ?? t("bible.knowledge.notInCanon")}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      </ScrollView>
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
      <Text style={[layout.body, { marginBottom: 14 }]}>{t("bible.knowledge.blurb")}</Text>

      {chapters.length > 0 ? (
        <ChapterScrubber stops={chapters.length + 1} value={stop} onChange={scrubTo} label={asOfLabel} colors={colors} />
      ) : null}

      {error ? (
        <AlertText style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
          {error}
        </AlertText>
      ) : null}
      {factsQuery.isError ? (
        <AlertText style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
          {t("bible.knowledge.loadError")}
        </AlertText>
      ) : null}

      <ChipRow
        options={[
          { value: "timeline", label: t("bible.knowledge.viewTimeline") },
          { value: "grid", label: t("bible.knowledge.viewGrid") },
        ]}
        value={view}
        onChange={(v) => setView(v === "grid" ? "grid" : "timeline")}
        colors={colors}
      />

      {view === "timeline" ? (
        <>
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
            characterPaths.map((path) => timelineFor(path))
          )}
        </>
      ) : (
        <>
          <ChipRow
            options={[{ value: "reader", label: t("bible.knowledge.readerColumn") }]}
            value={showReader ? "reader" : ""}
            onChange={() => setShowReader((on) => !on)}
            colors={colors}
          />
          {gridView()}
        </>
      )}

      <View style={[styles.addSection, { borderTopColor: colors.line }]}>
        <Text style={[styles.sectionTitle, { color: colors.inkSoft }]}>{t("bible.knowledge.addTitle")}</Text>
        {!selected ? (
          <ChipRow
            options={characters.map((p) => ({ value: p, label: bibleFileLabel(p) }))}
            value={addCharacter}
            onChange={setAddCharacter}
            colors={colors}
          />
        ) : null}
        <ChipRow options={stanceOptions} value={addStance} onChange={(v) => setAddStance(parseKnowledgeStance(v) ?? "knows")} colors={colors} />
        <TextInput
          style={[layout.input, { marginBottom: 8 }]}
          placeholder={t("bible.knowledge.factPlaceholder")}
          accessibilityLabel={t("bible.knowledge.factPlaceholder")}
          placeholderTextColor={colors.inkSoft}
          value={addFact}
          onChangeText={setAddFact}
          editable={!busy}
          multiline
        />
        <TopicField value={addTopic} onChange={setAddTopic} topics={topics} colors={colors} layout={layout} busy={busy} />
        <ChipRow options={chapterOptions} value={addChapterId} onChange={setAddChapterChoice} colors={colors} />
        <TapPressable
          onPress={() => void add()}
          disabled={busy || !addFact.trim() || !(selected || addCharacter)}
          style={[
            layout.primaryBtn,
            { marginTop: 4, opacity: busy || !addFact.trim() || !(selected || addCharacter) ? 0.5 : 1 },
          ]}
          accessibilityRole="button"
        >
          <Text style={layout.primaryBtnText}>{t("bible.knowledge.add")}</Text>
        </TapPressable>
      </View>
    </KeyboardAwareScrollView>
  );
}

function TopicField({
  value,
  onChange,
  topics,
  colors,
  layout,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  topics: string[];
  colors: Colors;
  layout: Layout;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const typed = value.trim().toLowerCase();
  const suggestions = topics.filter((topic) => topic.toLowerCase() !== typed && (!typed || topic.toLowerCase().includes(typed)));
  return (
    <>
      <TextInput
        style={[layout.input, { marginBottom: 8 }]}
        placeholder={t("bible.knowledge.topicPlaceholder")}
        accessibilityLabel={t("bible.knowledge.topicPlaceholder")}
        placeholderTextColor={colors.inkSoft}
        value={value}
        onChangeText={onChange}
        editable={!busy}
      />
      {suggestions.length > 0 ? (
        <ChipRow
          options={suggestions.map((topic) => ({ value: topic, label: topic }))}
          value=""
          onChange={onChange}
          colors={colors}
        />
      ) : null}
    </>
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
      keyboardShouldPersistTaps="handled"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <SelectChip
            key={opt.value || "__none__"}
            selected={active}
            tokens={{
              restFill: "transparent",
              activeFill: colors.accentSoft,
              restBorder: colors.line,
              activeBorder: colors.accent,
              restText: colors.inkSoft,
              activeText: colors.accent,
            }}
            onPress={() => onChange(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            surfaceStyle={styles.chip}
          >
            <SelectLabel style={{ fontSize: 13, fontWeight: active ? "600" : "400" }}>{opt.label}</SelectLabel>
          </SelectChip>
        );
      })}
    </ScrollView>
  );
}

/** Sure and right, leaning, sure and wrong, in the dark. */
function StanceBadge({ stance, label, colors }: { stance: KnowledgeStance; label: string; colors: Colors }) {
  const tone =
    stance === "knows" || stance === "suspects" ? colors.accent : stance === "believes_wrong" ? colors.danger : colors.inkSoft;
  return (
    <View
      testID={`stance-${stance}`}
      style={[
        styles.pill,
        {
          borderColor: tone,
          borderStyle: stance === "suspects" || stance === "unaware" ? "dashed" : "solid",
          backgroundColor: stance === "knows" ? colors.accentSoft : "transparent",
        },
      ]}
    >
      <Text style={{ color: tone, fontSize: 11, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

function Pill({ text, colors, italic }: { text: string; colors: Colors; italic?: boolean }) {
  return (
    <View style={[styles.pill, { borderColor: colors.line }]}>
      <Text style={{ color: colors.inkSoft, fontSize: 11, fontStyle: italic ? "italic" : "normal" }} numberOfLines={1}>
        {text}
      </Text>
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
  chipRow: { marginBottom: 12, flexGrow: 0 },
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
    maxWidth: 180,
    alignSelf: "flex-start",
  },
  factCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  laterCard: { opacity: 0.6 },
  factMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 },
  factText: { fontSize: 14, lineHeight: 20 },
  struck: { textDecorationLine: "line-through" },
  lineage: { fontSize: 12, marginTop: 4 },
  factActions: { flexDirection: "row", gap: 16, marginTop: 8 },
  action: { fontSize: 13 },
  changeHead: { fontSize: 13, fontWeight: "600", marginBottom: 8 },
  none: { fontSize: 13, marginBottom: 8 },
  divider: {
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    borderTopWidth: 1,
    borderStyle: "dashed",
    paddingTop: 8,
    marginTop: 4,
    marginBottom: 8,
  },
  retiredToggle: { fontSize: 13, marginTop: 2, marginBottom: 4 },
  addSection: { borderTopWidth: 1, paddingTop: 14, marginTop: 8 },
  gridRow: { flexDirection: "row", borderBottomWidth: 1, paddingVertical: 8 },
  gridHead: { fontSize: 12, fontWeight: "700" },
  gridTopic: { width: 120, paddingRight: 8 },
  gridTopicText: { fontSize: 13, fontWeight: "600" },
  gridCell: { width: 120, paddingRight: 8, gap: 4 },
  gridFact: { fontSize: 12, lineHeight: 16 },
});
