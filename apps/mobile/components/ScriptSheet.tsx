import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PAGE_COLUMNS, PAGE_LINES } from "../lib/screenplay";
import type { ScriptLine, ScriptPage } from "../lib/script-pages";
import { fonts, type ColorTokens } from "../lib/theme";

/** JetBrains Mono, like Courier, is 0.6 em wide, so 60 columns are 36 em. */
const ADVANCE = 0.6;
/** Air between the sheet's edge and the text, at the sheet's own scale. */
const EDGE = 0.02;

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
};

/**
 * Size a sheet to `width`: the largest type at which 60 columns fit between its
 * edges. Rounded down to a quarter point so the column never overflows. The
 * script is the same page at any size, since every glyph is the same width.
 */
export function sheetMetrics(width: number): SheetMetrics {
  const padding = Math.round(width * EDGE * 2);
  const fontSize = Math.max(4, Math.floor(((width - padding * 2) / (PAGE_COLUMNS * ADVANCE)) * 4) / 4);
  const lineHeight = Math.round(fontSize * 1.25 * 4) / 4;
  const paddingTop = padding + lineHeight * 1.5;
  return {
    width,
    height: paddingTop + lineHeight * PAGE_LINES + padding,
    fontSize,
    lineHeight,
    padding,
    paddingTop,
  };
}

function Row({
  line,
  metrics,
  color,
  boldFace,
}: {
  line: ScriptLine;
  metrics: SheetMetrics;
  color: string;
  boldFace: string;
}) {
  if (!line) return <View style={{ height: metrics.lineHeight }} />;
  return (
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      style={{
        fontFamily: line.bold ? boldFace : fonts.mono,
        fontSize: metrics.fontSize,
        lineHeight: metrics.lineHeight,
        height: metrics.lineHeight,
        color,
      }}
    >
      {line.text}
    </Text>
  );
}

/**
 * One page of a script, drawn the way it prints: 54 lines of 60 columns in a
 * monospace face, the page number top right from page 2. The text is already
 * indented to its column by the shared layout (lib/script-pages.ts); this only
 * puts it on a sheet.
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
          paddingHorizontal: metrics.padding,
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
        <Row key={index} line={line} metrics={metrics} color={colors.ink} boldFace={fonts.monoMedium} />
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
