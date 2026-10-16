import { useEffect, type ComponentType, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { selectionActionsFor, type SelectionActionId } from "../lib/selection-menu";
import {
  DOCK_ACTIONS_ROW,
  DOCK_SYNONYMS_ROW,
  SYNONYMS_SHOWN,
  dockFrame,
  hasSynonymsRow,
  useSelectionDock,
  type DockFrame,
  type SelectionDockModel,
} from "../lib/selection-dock";
import { EASE_OUT, PRESS_SCALE, SELECTION_MENU_MS } from "../lib/motion";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, fonts } from "../lib/theme";
import { alpha } from "./Glass";
import { CommentIcon, ExpandIcon, FixIcon, QuoteIcon, RewriteIcon } from "./icons";
import { TapPressable } from "./TapPressable";

const ICONS: Record<SelectionActionId, ComponentType<{ color: string; size?: number }>> = {
  comment: CommentIcon,
  rewrite: RewriteIcon,
  describe: QuoteIcon,
  expand: ExpandIcon,
  fix: FixIcon,
};

/** Room the strip leaves at its edges, and a synonym chip never grows past the page minus this (a long phrase truncates). */
const SIDE_GUTTER = 20;
const CHIP_GUTTERS = SIDE_GUTTER * 2 + 24;

/**
 * A row that scrolls sideways, with a fade on its right edge saying there is more.
 * `top` hangs the content from the row's top, where the Focus / Listen pills sit
 * in the header's own row; otherwise it is centred.
 */
function ScrollRow({
  height,
  children,
  bg,
  top = false,
}: {
  height?: number;
  children: ReactNode;
  bg: string;
  top?: boolean;
}) {
  return (
    <View style={[styles.scroller, top ? styles.scrollerTop : null, height ? { height } : null]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={top ? [styles.row, styles.rowTop] : styles.row}
      >
        {children}
      </ScrollView>
      <LinearGradient
        pointerEvents="none"
        colors={[alpha(bg, 0), bg]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.fade}
      />
    </View>
  );
}

/**
 * What the writer can do with highlighted text: a passage gets Comment,
 * Rewrite, Describe, Expand and Fix; one word gets Comment, Describe and Fix
 * with its synonyms after them. Stacked, the actions sit in the row of the
 * header's Focus / Listen pills and the synonyms in the progress bar's; in one
 * row, both follow each other. Either way a row scrolls sideways instead of
 * wrapping or growing, so nothing can run past the page. It only draws and
 * reports: what each button does is the screen's (see `useSelectionMenu`).
 * Taps never take focus from the editor, so the keyboard and the selection
 * stay where they were.
 */
export function SelectionDock({
  model,
  stacked = false,
  testID = "selection-dock",
}: {
  model: SelectionDockModel;
  /** Actions and synonyms in two rows (the header's pills and meter rows) rather than one. */
  stacked?: boolean;
  testID?: string;
}) {
  const { target, word, synonyms, onAction, onSynonym } = model;
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const { width } = useWindowDimensions();
  const chipMaxWidth = Math.max(120, width - CHIP_GUTTERS);

  const showChips = hasSynonymsRow(model);

  const actions = selectionActionsFor(target).map((action) => {
    const Icon = ICONS[action];
    return (
      <TapPressable
        key={action}
        testID={`selection-action-${action}`}
        scale={PRESS_SCALE.chip}
        accessibilityLabel={t(`selectionMenu.${action}`)}
        onPress={() => onAction(action)}
        style={[styles.action, { borderColor: colors.line, backgroundColor: colors.panel }]}
      >
        <Icon color={colors.accent} size={16} />
        <Text numberOfLines={1} style={[styles.actionLabel, { color: colors.ink }]}>
          {t(`selectionMenu.${action}`)}
        </Text>
      </TapPressable>
    );
  });

  const chips = showChips
    ? synonyms.status === "loading"
      ? [54, 66, 48].map((chipWidth, index) => (
          <View
            key={index}
            testID={index === 0 ? "selection-synonyms-loading" : undefined}
            accessible={index === 0}
            accessibilityLabel={index === 0 ? t("selectionMenu.synonymsLoading") : undefined}
            style={[styles.chip, { width: chipWidth, backgroundColor: colors.panel2, opacity: 0.7 }]}
          />
        ))
      : synonyms.list.map((synonym, index) => (
          <TapPressable
            key={`${index}-${synonym}`}
            testID={`selection-synonym-${synonym}`}
            scale={PRESS_SCALE.chip}
            accessibilityLabel={t("selectionMenu.replaceA11y", { word, synonym })}
            onPress={() => onSynonym(synonym, index >= SYNONYMS_SHOWN)}
            style={[styles.chip, { backgroundColor: colors.panel2, maxWidth: chipMaxWidth }]}
          >
            <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.chipLabel, { color: colors.ink }]}>
              {synonym}
            </Text>
          </TapPressable>
        ))
    : null;

  return (
    <View
      testID={testID}
      accessibilityRole="toolbar"
      accessibilityLabel={t("selectionMenu.label")}
      style={styles.strip}
    >
      {stacked ? (
        <>
          <ScrollRow height={DOCK_ACTIONS_ROW} bg={colors.bg} top>
            {actions}
          </ScrollRow>
          {chips ? (
            <ScrollRow height={DOCK_SYNONYMS_ROW} bg={colors.bg}>
              {chips}
            </ScrollRow>
          ) : null}
        </>
      ) : (
        <ScrollRow bg={colors.bg}>
          {actions}
          {chips ? <View style={[styles.divider, { backgroundColor: colors.line }]} /> : null}
          {chips}
        </ScrollRow>
      )}
    </View>
  );
}

/**
 * Hangs the strip over the header while the screen has a selection to act on.
 * Mounted by the tabs layout, which knows where the header ends; `visible` is
 * only the manuscript tab. The strip fades in over what it covers, and a new
 * selection starts it from the left again.
 */
export function SelectionDockHost({
  visible,
  headerHeight,
  safeTop,
  focused,
  meterShown,
}: {
  visible: boolean;
  headerHeight: number;
  safeTop: number;
  /** Focus mode has the header away. */
  focused: boolean;
  /** The writing meter shows under the Focus / Listen pills. */
  meterShown: boolean;
}) {
  const model = useSelectionDock();
  if (!visible || !model) return null;
  const frame = dockFrame({ headerHeight, safeTop, focused, meterShown, synonymsRow: hasSynonymsRow(model) });
  return <DockSurface key={`${model.target}:${model.word}`} model={model} frame={frame} />;
}

function DockSurface({ model, frame }: { model: SelectionDockModel; frame: DockFrame }) {
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = withTiming(1, { duration: SELECTION_MENU_MS, easing: EASE_OUT });
  }, [shown]);
  const style = useAnimatedStyle(() => ({ opacity: shown.value }));
  return (
    <Animated.View
      testID="selection-dock-host"
      style={[styles.host, { top: frame.top, height: frame.height, backgroundColor: colors.bg }, style]}
    >
      <SelectionDock model={model} stacked={frame.stacked} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: 0, right: 0, zIndex: 30 },
  strip: { flex: 1 },
  scroller: { flex: 1, justifyContent: "center" },
  scrollerTop: { flex: 0, justifyContent: "flex-start" },
  // The header's own pills start a point under the top of the row the strip covers.
  rowTop: { alignItems: "flex-start", paddingTop: 1 },
  row: { alignItems: "center", gap: 8, paddingLeft: SIDE_GUTTER, paddingRight: SIDE_GUTTER + 24 },
  fade: { position: "absolute", top: 0, bottom: 0, right: 0, width: 28 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
  },
  actionLabel: { fontFamily: fonts.sans, fontSize: 13, fontWeight: "600" },
  divider: { width: StyleSheet.hairlineWidth, height: 20, marginHorizontal: 2 },
  chip: { height: 32, minWidth: 40, paddingHorizontal: 12, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  chipLabel: { fontFamily: fonts.sans, fontSize: 15 },
});
