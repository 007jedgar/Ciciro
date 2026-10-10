import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../lib/settings";
import {
  TITLE_PAGE_FIELDS,
  TITLE_PAGE_LIMITS,
  normalizeTitlePage,
  resolveTitlePage,
  type ScriptSettings,
  type TitlePage,
} from "../lib/screenplay";
import { TapPressable } from "./TapPressable";

const MULTILINE: readonly (keyof TitlePage)[] = ["contact"];

/**
 * The screenplay's title page: the six lines the PDF's first page and a
 * Fountain or FDX export open with. A blank title or author is the
 * manuscript's own, shown as the placeholder. Saved with the button, like the
 * manuscript's details, so half a line is never stored.
 */
export function TitlePageFields({
  settings,
  manuscript,
  saving = false,
  onSave,
}: {
  settings: ScriptSettings;
  /** The manuscript's own title and author, which a blank title page falls back on. */
  manuscript: { title: string; author: string };
  saving?: boolean;
  onSave: (next: ScriptSettings) => void;
}) {
  const { t } = useTranslation();
  const { layout, colors, settings: app } = useAppTheme();
  const [page, setPage] = useState<TitlePage>(settings.titlePage);
  const [saved, setSaved] = useState(false);
  const clean = normalizeTitlePage(page);
  const dirty = TITLE_PAGE_FIELDS.some((field) => clean[field] !== settings.titlePage[field]);
  const canSave = dirty && !saving;
  const resolved = resolveTitlePage(settings.titlePage, manuscript);

  const placeholder = (field: keyof TitlePage) => {
    if (field === "title") return resolved.title;
    if (field === "author") return manuscript.author;
    return t(`screenplay.settings.titlePage.placeholders.${field}`, { defaultValue: "" });
  };

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 6 }}>
      <Text style={{ fontSize: 17, color: colors.ink }}>{t("screenplay.settings.titlePage.title")}</Text>
      <Text style={{ fontSize: 13, lineHeight: 18, color: colors.inkSoft }}>{t("screenplay.settings.titlePage.note")}</Text>
      {TITLE_PAGE_FIELDS.map((field) => {
        const label = t(`screenplay.settings.titlePage.fields.${field}`);
        const multiline = MULTILINE.includes(field);
        return (
          <View key={field}>
            <Text style={[layout.cardMeta, { marginTop: 8, marginBottom: 6 }]}>{label}</Text>
            <TextInput
              aria-label={label}
              testID={`title-page-${field}`}
              value={page[field]}
              maxLength={TITLE_PAGE_LIMITS[field]}
              placeholder={placeholder(field)}
              placeholderTextColor={colors.inkSoft}
              autoCorrect={app.autoCorrect && field !== "contact"}
              spellCheck={app.autoCorrect && field !== "contact"}
              editable={!saving}
              multiline={multiline}
              onChangeText={(next) => {
                setPage({ ...page, [field]: next });
                setSaved(false);
              }}
              style={multiline ? [layout.input, { minHeight: 84, textAlignVertical: "top" }] : layout.input}
            />
          </View>
        );
      })}
      <TapPressable
        style={[layout.primaryBtn, { opacity: canSave ? 1 : 0.5 }]}
        onPress={() => {
          if (!canSave) return;
          setSaved(true);
          onSave({ ...settings, titlePage: clean });
        }}
        disabled={!canSave}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSave, busy: saving }}
        accessibilityLabel={t("screenplay.settings.titlePage.save")}
      >
        <Text style={layout.primaryBtnText}>
          {saving ? t("common.saving") : saved && !dirty ? t("screenplay.settings.titlePage.saved") : t("screenplay.settings.titlePage.save")}
        </Text>
      </TapPressable>
    </View>
  );
}
