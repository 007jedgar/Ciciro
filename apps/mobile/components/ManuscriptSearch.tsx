import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ApiError, ciciro } from "../lib/api";
import { useProject } from "../lib/project";
import {
  groupMatches,
  matchKey,
  replaceInManuscript,
  SearchUnsyncedError,
  type SearchMatch,
  type SearchResult,
} from "../lib/search";
import { useAppTheme } from "../lib/settings";

const DEBOUNCE_MS = 300;

/** Find and replace across every chapter, with tap-to-jump results. */
export function ManuscriptSearch({
  projectId,
  onJump,
}: {
  projectId: string;
  onJump: (match: SearchMatch) => void;
}) {
  const { t } = useTranslation();
  const { layout, colors, settings } = useAppTheme();
  const { flushEdits, reload } = useProject();
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (signal?: AbortSignal) => {
      if (!query) {
        setResult(null);
        setError(null);
        return;
      }
      try {
        const found = await ciciro.search.find(projectId, query, { matchCase, wholeWord }, { signal });
        setResult(found);
        setError(null);
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof ApiError ? err.message : t("search.error"));
      }
    },
    [projectId, query, matchCase, wholeWord, t]
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setNotice(null);
      void run(controller.signal);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [run]);

  async function replace(target?: SearchMatch) {
    if (busy || !query) return;
    setBusy(true);
    setError(null);
    try {
      const count = await replaceInManuscript(
        projectId,
        query,
        replacement,
        { matchCase, wholeWord },
        { target, flush: flushEdits }
      );
      setNotice(t("search.replaced", { count }));
      reload();
    } catch (err) {
      setError(
        err instanceof SearchUnsyncedError
          ? t("search.unsynced")
          : err instanceof ApiError
            ? err.message
            : t("search.replaceError")
      );
    } finally {
      setBusy(false);
      await run();
    }
  }

  function confirmReplaceAll() {
    if (!result || result.total === 0) return;
    Alert.alert(t("search.confirmTitle"), t("search.confirmMessage", { count: result.total }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("search.replaceAll"), style: "destructive", onPress: () => void replace() },
    ]);
  }

  const groups = groupMatches(result?.matches ?? []);
  const summary = error
    ? error
    : notice
      ? notice
      : result
        ? result.total === 0
          ? t("search.none")
          : `${t("search.summary", { count: result.total, chapters: result.chapters })}${
              result.truncated ? ` ${t("search.truncated", { shown: result.matches.length })}` : ""
            }`
        : t("search.idle");

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
      <TextInput
        style={layout.input}
        aria-label={t("search.findPlaceholder")}
        placeholder={t("search.findPlaceholder")}
        placeholderTextColor={colors.inkSoft}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        spellCheck={false}
        autoCapitalize="none"
        returnKeyType="search"
        maxLength={200}
      />
      <TextInput
        style={layout.input}
        aria-label={t("search.replacePlaceholder")}
        placeholder={t("search.replacePlaceholder")}
        placeholderTextColor={colors.inkSoft}
        value={replacement}
        onChangeText={setReplacement}
        autoCorrect={settings.autoCorrect}
        spellCheck={settings.autoCorrect}
        maxLength={2000}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Text style={layout.cardMeta}>{t("search.matchCase")}</Text>
        <Switch value={matchCase} onValueChange={setMatchCase} accessibilityLabel={t("search.matchCase")} />
        <Text style={[layout.cardMeta, { marginLeft: 8 }]}>{t("search.wholeWord")}</Text>
        <Switch value={wholeWord} onValueChange={setWholeWord} accessibilityLabel={t("search.wholeWord")} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 12 }}>
        <Text
          style={[error ? layout.error : layout.cardMeta, { flex: 1 }]}
          accessibilityLiveRegion="polite"
        >
          {summary}
        </Text>
        {busy ? <ActivityIndicator color={colors.accent} /> : null}
        <Pressable
          onPress={confirmReplaceAll}
          disabled={busy || !result || result.total === 0}
          accessibilityRole="button"
          accessibilityLabel={t("search.replaceAll")}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 10,
            backgroundColor: colors.accent,
            opacity: busy || !result || result.total === 0 ? 0.4 : 1,
          }}
        >
          <Text style={{ color: colors.bg, fontWeight: "600" }}>{t("search.replaceAll")}</Text>
        </Pressable>
      </View>
      {groups.map((group) => (
        <View key={group.chapterId} style={{ marginBottom: 12 }}>
          <Text style={[layout.cardMeta, { marginBottom: 4, fontWeight: "600" }]}>
            {group.number}. {group.title || t("chapters.newTitle")}
          </Text>
          {group.matches.map((match) => (
            <View key={matchKey(match)} style={[layout.card, { marginBottom: 8, padding: 12 }]}>
              <Pressable
                onPress={() => onJump(match)}
                accessibilityRole="button"
                accessibilityLabel={t("search.jump", { title: group.title || t("chapters.newTitle") })}
              >
                <Text style={[layout.body, { marginBottom: 8 }]}>
                  {match.before}
                  <Text style={{ backgroundColor: colors.accentSoft, fontWeight: "700" }}>{match.match}</Text>
                  {match.after}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void replace(match)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t("search.replace")}
                style={{ alignSelf: "flex-start", opacity: busy ? 0.4 : 1 }}
              >
                <Text style={{ color: colors.accent, fontWeight: "600" }}>{t("search.replace")}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
