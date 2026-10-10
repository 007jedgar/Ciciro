import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PAGE_COLUMNS, PAGE_LINES } from "../lib/screenplay";
import type { ScriptLine, ScriptPage } from "../lib/script-pages";
import { fonts, type ColorTokens } from "../lib/theme";

/** JetBrains Mono, like Courier, is 0.6 em wide, so 60 columns are 36 em. */
const ADVANCE = 0.6;
/** Air between the sheet's edge and the text, at the sheet's own scale. */
const EDGE = 0.02;
/** Columns kept clear on each side of the text for scene numbers: room for three digits and a space. */
export const NUMBER_GUTTER = 4;

export type SheetMetrics = {
  /** The sheet's width. */
  width: number;
  /** The sheet's height: a full page of lines plus its edges, the same for every page. */
  height: number;
  fontSize: number;
  lineHeight: number;
  /** Space left and right of the 60 column text. */
  padding: number;
  paddingTop: number;
  /** Extra space on each side of the text, for scene numbers; 0 when there are none. */
  gutter: number;
  /** The 60 columns' width. */
  columns: number;
};

/**
 * Size a sheet to `width`: the largest type at which 60 columns (and, for a
 * numbered script, `gutterColumns` more on each side) fit between its edges.
 * Rounded down to a quarter point so the column never overflows. The script is
 * the same page at any size, since every glyph is the same width.
 */
export function sheetMetrics(width: number, gutterColumns = 0): SheetMetrics {
  const padding = Math.round(width * EDGE * 2);
  const across = PAGE_COLUMNS + gutterColumns * 2;
  const fontSize = Math.max(4, Math.floor(((width - padding * 2) / (across * ADVANCE)) * 4) / 4);
  const lineHeight = Math.round(fontSize * 1.25 * 4) / 4;
  const paddingTop = padding + lineHeight * 1.5;
  return {
    width,
    height: paddingTop + lineHeight * PAGE_LINES + padding,
    fontSize,
    lineHeight,
    padding,
    paddingTop,
    gutter: gutterColumns * fontSize * ADVANCE,
    columns: PAGE_COLUMNS * fontSize * ADVANCE,
  };
}

function Row({
  line,
  metrics,
  color,
  numberColor,
  boldFace,
}: {
  line: ScriptLine;
  metrics: SheetMetrics;
  color: string;
  numberColor: string;
  boldFace: string;
}) {
  if (!line) return <View style={{ height: metrics.lineHeight }} />;
  const text = {
    fontSize: metrics.fontSize,
    lineHeight: metrics.lineHeight,
    height: metrics.lineHeight,
  };
  const face = line.bold ? boldFace : fonts.mono;
  if (!line.sceneNumber) {
    return (
      <Text allowFontScaling={false} numberOfLines={1} style={{ ...text, fontFamily: face, color }}>
        {line.text}
      </Text>
    );
  }
  // A scene's number sits in both margins of its heading, outside the 60 columns.
  // The heading's own box is a column wider than the 60, so a full line never
  // truncates on a rounding error; the right number starts where that column ends.
  const column = metrics.fontSize * ADVANCE;
  const number = { ...text, fontFamily: fonts.mono, color: numberColor };
  return (
    <View
      testID="script-scene-number"
      style={{ flexDirection: "row", marginLeft: -metrics.gutter, height: metrics.lineHeight }}
    >
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={{ ...number, width: metrics.gutter, paddingRight: column, textAlign: "right" }}
      >
        {line.sceneNumber}
      </Text>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={{ ...text, fontFamily: face, color, width: metrics.columns + column }}
      >
        {line.text}
      </Text>
      <Text allowFontScaling={false} numberOfLines={1} style={{ ...number, width: metrics.gutter - column }}>
        {line.sceneNumber}
      </Text>
    </View>
  );
}

/**
 * One page of a script, drawn the way it prints: 54 lines of 60 columns in a
 * monospace face, the page number top right from page 2, a scene's number in
 * both margins of its heading when the script numbers its scenes. The text is
 * already indented to its column by the shared typeset (lib/script-pages.ts);
 * this only puts it on a sheet.
 */
export const ScriptSheet = memo(function ScriptSheet({
  page,
  metrics,
  colors,
  label,
}: {
  page: ScriptPage;
  metrics: SheetMetrics;
  colors: Pick<ColorTokens, "panel" | "line" | "ink" | "inkSoft">;
  /** Read aloud for the sheet: "Page 12". */
  label: string;
}) {
  return (
    <View
      testID={`script-page-${page.number}`}
      accessible
      accessibilityLabel={label}
      style={[
        styles.sheet,
        {
          width: metrics.width,
          height: metrics.height,
          paddingHorizontal: metrics.padding + metrics.gutter,
          paddingTop: metrics.paddingTop,
          backgroundColor: colors.panel,
          borderColor: colors.line,
        },
      ]}
    >
      {page.number > 1 ? (
        <Text
          allowFontScaling={false}
          style={[
            styles.number,
            {
              top: metrics.padding,
              right: metrics.padding,
              fontFamily: fonts.mono,
              fontSize: metrics.fontSize,
              lineHeight: metrics.lineHeight,
              color: colors.inkSoft,
            },
          ]}
        >
          {`${page.number}.`}
        </Text>
      ) : null}
      {page.lines.map((line, index) => (
        <Row
          key={index}
          line={line}
          metrics={metrics}
          color={colors.ink}
          numberColor={colors.inkSoft}
          boldFace={fonts.monoMedium}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  sheet: {
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  number: { position: "absolute" },
});
