import { useEffect, useState, type ComponentType } from "react";
import { ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { selectionActionsFor, type SelectionActionId } from "../lib/selection-menu";
import {
  frameVisible,
  placeSelectionMenu,
  SYNONYMS_SHOWN,
  type SelectionFrame,
} from "../lib/selection-menu-view";
import { EASE_OUT, PRESS_SCALE, SELECTION_MENU_MS } from "../lib/motion";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, fonts } from "../lib/theme";
import type { Synonyms } from "../lib/use-synonyms";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { alpha, Glass } from "./Glass";
import { CommentIcon, ExpandIcon, FixIcon, QuoteIcon, RewriteIcon } from "./icons";
import { TapPressable } from "./TapPressable";

const ICONS: Record<SelectionActionId, ComponentType<{ color: string; size?: number }>> = {
  comment: CommentIcon,
  rewrite: RewriteIcon,
  describe: QuoteIcon,
  expand: ExpandIcon,
  fix: FixIcon,
};

/** The expanded synonym list scrolls past two rows of chips, so the menu still fits under the word with the keyboard up. */
const LIST_MAX_HEIGHT = 70;

/**
 * The menu that opens over highlighted text. A passage gets Comment, Rewrite,
 * Describe, Expand and Fix; one word gets Comment, Describe and Fix with its
 * synonyms in a row of chips underneath, the first few shown and the rest
 * behind "N more...". It only draws and reports: what each button does is the
 * screen's (see `useSelectionMenu`). Taps never take focus from the editor,
 * so the keyboard and the selection stay where they were.
 */
export function SelectionMenu({
  target,
  word,
  synonyms,
  maxWidth,
  onAction,
  onSynonym,
  testID = "selection-menu",
}: {
  target: "word" | "passage";
  word: string;
  synonyms: Synonyms;
  maxWidth: number;
  onAction: (action: SelectionActionId) => void;
  onSynonym: (synonym: string, fromMore: boolean) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const dark = themed?.dark ?? false;
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [word]);

  const actions = selectionActionsFor(target);
  const showChips = target === "word" && (synonyms.status === "loading" || synonyms.status === "ready");
  const list = synonyms.list;
  const hidden = Math.max(0, list.length - SYNONYMS_SHOWN);

  const chip = (synonym: string, fromMore: boolean) => (
    <TapPressable
      key={`${fromMore ? "m" : "s"}-${synonym}`}
      testID={`selection-synonym-${synonym}`}
      scale={PRESS_SCALE.chip}
      accessibilityLabel={t("selectionMenu.replaceA11y", { word, synonym })}
      onPress={() => onSynonym(synonym, fromMore)}
      style={[styles.chip, { backgroundColor: colors.panel2 }]}
    >
      <Text numberOfLines={1} style={[styles.chipLabel, { color: colors.ink }]}>
        {synonym}
      </Text>
    </TapPressable>
  );

  return (
    <Glass dark={dark} colors={colors} radius={18} style={[styles.panel, { maxWidth }]}>
      <View
        testID={testID}
        accessibilityRole="toolbar"
        accessibilityLabel={t("selectionMenu.label")}
      >
        <View style={styles.actions}>
          {actions.map((action) => {
            const Icon = ICONS[action];
            return (
              <TapPressable
                key={action}
                testID={`selection-action-${action}`}
                scale={PRESS_SCALE.chip}
                accessibilityLabel={t(`selectionMenu.${action}`)}
                onPress={() => onAction(action)}
                style={styles.action}
              >
                <Icon color={colors.ink} size={20} />
                <Text numberOfLines={1} style={[styles.actionLabel, { color: colors.ink }]}>
                  {t(`selectionMenu.${action}`)}
                </Text>
              </TapPressable>
            );
          })}
        </View>
        {showChips ? (
          <>
            <View style={[styles.rule, { backgroundColor: alpha(colors.line, 0.8) }]} />
            {synonyms.status === "loading" ? (
              <View
                testID="selection-synonyms-loading"
                accessible
                accessibilityLabel={t("selectionMenu.synonymsLoading")}
                style={styles.chips}
              >
                {[54, 66, 48].map((width, index) => (
                  <View
                    key={index}
                    style={[styles.chip, { width, backgroundColor: colors.panel2, opacity: 0.7 }]}
                  />
                ))}
              </View>
            ) : expanded ? (
              <ScrollView
                style={{ maxHeight: LIST_MAX_HEIGHT }}
                contentContainerStyle={styles.wrap}
                keyboardShouldPersistTaps="always"
                nestedScrollEnabled
                accessibilityLabel={t("selectionMenu.synonymsLabel", { word })}
              >
                {list.map((synonym, index) => chip(synonym, index >= SYNONYMS_SHOWN))}
                <TapPressable
                  testID="selection-synonyms-fewer"
                  feedback="dim"
                  accessibilityLabel={t("selectionMenu.fewer")}
                  onPress={() => setExpanded(false)}
                  style={styles.more}
                >
                  <Text style={[styles.chipLabel, { color: colors.inkSoft }]}>{t("selectionMenu.fewer")}</Text>
                </TapPressable>
              </ScrollView>
            ) : (
              <View style={styles.chips} accessibilityLabel={t("selectionMenu.synonymsLabel", { word })}>
                {list.slice(0, SYNONYMS_SHOWN).map((synonym) => chip(synonym, false))}
                {hidden > 0 ? (
                  <TapPressable
                    testID="selection-synonyms-more"
                    feedback="dim"
                    accessibilityLabel={t("selectionMenu.more", { count: hidden })}
                    onPress={() => setExpanded(true)}
                    style={styles.more}
                  >
                    <Text numberOfLines={1} style={[styles.chipLabel, { color: colors.inkSoft }]}>
                      {t("selectionMenu.more", { count: hidden })}
                    </Text>
                  </TapPressable>
                ) : null}
              </View>
            )}
          </>
        ) : null}
      </View>
    </Glass>
  );
}

/**
 * The fade and settle a menu plays as it opens. Reduce motion keeps the fade
 * and drops the scale.
 */
function useMenuEntrance() {
  const reduceMotion = useReduceMotion();
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = withTiming(1, { duration: SELECTION_MENU_MS, easing: EASE_OUT });
  }, [shown]);
  const start = reduceMotion ? 1 : 0.96;
  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ scale: start + (1 - start) * shown.value }],
  }));
  return { style };
}

/** The menu with no anchor to hang from (an editor that cannot say where the selection is): in the flow of whatever holds it. */
export function InlineSelectionMenu(props: Parameters<typeof SelectionMenu>[0]) {
  const { style } = useMenuEntrance();
  return (
    <Animated.View style={style}>
      <SelectionMenu {...props} />
    </Animated.View>
  );
}

/**
 * The menu hung by the selection: below it, where the system callout (Cut,
 * Copy, Paste) is not, above when the page runs out, and following it as the
 * page scrolls. `frame` is the native editor's report of where the selection
 * sits; it is written from the JS thread and read on the UI thread, so a
 * scroll moves the menu without a render.
 */
export function AnchoredSelectionMenu({
  frame,
  boundsWidth,
  boundsHeight,
  ...props
}: Parameters<typeof SelectionMenu>[0] & {
  frame: SharedValue<SelectionFrame | null>;
  boundsWidth: number;
  boundsHeight: number;
}) {
  const reduceMotion = useReduceMotion();
  const measuredWidth = useSharedValue(0);
  const measuredHeight = useSharedValue(0);
  const shown = useSharedValue(0);
  const duration = SELECTION_MENU_MS;
  const rest = reduceMotion ? 1 : 0.96;

  const onLayout = (event: LayoutChangeEvent) => {
    measuredWidth.value = event.nativeEvent.layout.width;
    measuredHeight.value = event.nativeEvent.layout.height;
  };

  useEffect(() => {
    shown.value = withTiming(1, { duration, easing: EASE_OUT });
  }, [shown, duration]);

  const style = useAnimatedStyle(() => {
    const at = frame.value;
    const width = measuredWidth.value;
    const height = measuredHeight.value;
    if (!at || width === 0 || height === 0 || !frameVisible(at, boundsHeight)) {
      return { opacity: 0, left: 0, top: 0 };
    }
    const placed = placeSelectionMenu(at, width, height, boundsWidth, boundsHeight);
    return {
      opacity: shown.value,
      left: placed.left,
      top: placed.top,
      transform: [{ scale: rest + (1 - rest) * shown.value }],
    };
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      onLayout={onLayout}
      style={[styles.anchored, { maxWidth: Math.max(0, boundsWidth - 16) }, style]}
    >
      <SelectionMenu {...props} maxWidth={Math.max(0, boundsWidth - 16)} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: { paddingHorizontal: 6, paddingVertical: 6, alignSelf: "flex-start" },
  anchored: { position: "absolute", alignSelf: "flex-start" },
  actions: { flexDirection: "row", alignItems: "center", gap: 2 },
  action: {
    minWidth: 58,
    height: 52,
    paddingHorizontal: 6,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  actionLabel: { fontFamily: fonts.sans, fontSize: 11.5, fontWeight: "500" },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 6, marginHorizontal: 4 },
  chips: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2, paddingBottom: 2 },
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, paddingHorizontal: 2, paddingBottom: 2 },
  chip: { height: 32, minWidth: 40, paddingHorizontal: 12, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  more: { height: 32, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  chipLabel: { fontFamily: fonts.sans, fontSize: 15 },
});
