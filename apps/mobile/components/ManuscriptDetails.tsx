import { useRef, useState } from "react";
import { Alert, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  useDeleteProjectMutation,
  useFoldersQuery,
  usePatchProjectMutation,
} from "../lib/api";
import { normalizeKind } from "../lib/manuscript-kind";
import { useAppTheme } from "../lib/settings";
import type { ProjectDetail } from "../lib/types";
import { CheckIcon } from "./icons";
import { PressableCard } from "./PressableCard";
import { TapPressable } from "./TapPressable";

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * The manuscript itself, rather than any chapter of it: its title, author and
 * logline, the folder it is filed in, and deleting it. None of these had a
 * home on the phone, so a typo in a title, or a manuscript made by mistake,
 * could only be fixed on the web.
 */
export function ManuscriptDetails({
  project,
  onDeleted,
}: {
  project: ProjectDetail;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const { layout, colors, settings } = useAppTheme();
  const kind = normalizeKind(project.kind);
  const patch = usePatchProjectMutation();
  const remove = useDeleteProjectMutation();
  const folders = useFoldersQuery();
  const [title, setTitle] = useState(project.title);
  const [author, setAuthor] = useState(project.author);
  const [logline, setLogline] = useState(project.logline);
  const authorRef = useRef<TextInput>(null);
  const loglineRef = useRef<TextInput>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    title.trim() !== project.title.trim() ||
    author.trim() !== project.author.trim() ||
    logline.trim() !== project.logline.trim();
  const canSave = dirty && title.trim().length > 0 && !patch.isPending;
  const folderList = folders.data ?? [];
  const loglineLabel = kind === "blog" ? t("kinds.subtitleLabel") : t("details.logline");

  function save() {
    if (!canSave) return;
    setError(null);
    setSaved(false);
    patch.mutate(
      {
        id: project.id,
        body: { title: title.trim(), author: author.trim(), logline: logline.trim() },
      },
      {
        onSuccess: () => setSaved(true),
        onError: (err) => setError(errorText(err, t("details.saveError"))),
      }
    );
  }

  function moveTo(folderId: string | null) {
    if ((project.folderId ?? null) === folderId || patch.isPending) return;
    setError(null);
    patch.mutate(
      { id: project.id, body: { folderId } },
      { onError: (err) => setError(errorText(err, t("details.folderError"))) }
    );
  }

  function confirmDelete() {
    Alert.alert(
      t("details.deleteTitle", { title: project.title || t("manuscripts.untitled") }),
      t("details.deleteMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => {
            setError(null);
            remove.mutate(project.id, {
              onSuccess: onDeleted,
              onError: (err) => setError(errorText(err, t("details.deleteError"))),
            });
          },
        },
      ]
    );
  }

  const fieldProps = {
    style: layout.input,
    placeholderTextColor: colors.inkSoft,
    autoCorrect: settings.autoCorrect,
    spellCheck: settings.autoCorrect,
    editable: !patch.isPending && !remove.isPending,
  } as const;

  return (
    <View>
      <Text style={[layout.cardMeta, { marginBottom: 8 }]}>{t("details.titleLabel")}</Text>
      <TextInput
        {...fieldProps}
        aria-label={t("details.titleLabel")}
        value={title}
        onChangeText={(next) => {
          setTitle(next);
          setSaved(false);
        }}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => authorRef.current?.focus()}
      />
      <Text style={[layout.cardMeta, { marginBottom: 8 }]}>{t("details.authorLabel")}</Text>
      <TextInput
        {...fieldProps}
        ref={authorRef}
        aria-label={t("details.authorLabel")}
        value={author}
        onChangeText={(next) => {
          setAuthor(next);
          setSaved(false);
        }}
        autoComplete="name"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => loglineRef.current?.focus()}
      />
      <Text style={[layout.cardMeta, { marginBottom: 8 }]}>{loglineLabel}</Text>
      <TextInput
        {...fieldProps}
        ref={loglineRef}
        aria-label={loglineLabel}
        value={logline}
        onChangeText={(next) => {
          setLogline(next);
          setSaved(false);
        }}
        multiline
        style={[layout.input, { minHeight: 72, textAlignVertical: "top" }]}
      />

      {error ? (
        <Text style={layout.error} role="alert">
          {error}
        </Text>
      ) : null}

      <TapPressable
        style={[layout.primaryBtn, { opacity: canSave ? 1 : 0.5 }]}
        onPress={save}
        disabled={!canSave}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSave, busy: patch.isPending }}
        accessibilityLabel={t("common.save")}
      >
        <Text style={layout.primaryBtnText}>
          {patch.isPending ? t("common.saving") : saved && !dirty ? t("details.saved") : t("common.save")}
        </Text>
      </TapPressable>

      {folderList.length > 0 ? (
        <View style={{ marginTop: 24 }}>
          <Text style={[layout.cardMeta, { marginBottom: 8 }]}>{t("details.folder")}</Text>
          <View accessibilityRole="radiogroup">
            {[{ id: null as string | null, name: t("manuscripts.unfiled") }, ...folderList].map((option) => {
              const selected = (project.folderId ?? null) === option.id;
              return (
                <PressableCard
                  key={option.id ?? "unfiled"}
                  style={[
                    layout.card,
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      paddingVertical: 12,
                      marginBottom: 8,
                      borderColor: selected ? colors.accent : colors.line,
                    },
                  ]}
                  onPress={() => moveTo(option.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={option.name}
                >
                  <Text style={[layout.cardTitle, { flex: 1, fontSize: 16 }]}>{option.name}</Text>
                  {selected ? <CheckIcon color={colors.accent} size={18} /> : null}
                </PressableCard>
              );
            })}
          </View>
        </View>
      ) : null}

      <TapPressable
        style={[layout.ghostBtn, { marginTop: 24 }]}
        onPress={confirmDelete}
        disabled={remove.isPending}
        accessibilityRole="button"
        accessibilityLabel={t("details.delete")}
      >
        <Text style={[layout.ghostBtnText, { color: colors.danger }]}>
          {remove.isPending ? t("details.deleting") : t("details.delete")}
        </Text>
      </TapPressable>
    </View>
  );
}
