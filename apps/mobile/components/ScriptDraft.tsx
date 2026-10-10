import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { parseScriptLines } from "../lib/manuscript-kind";
import { ELEMENT_METRICS, PAGE_COLUMNS, blankLinesBefore, normalizeElement } from "../lib/screenplay";
import { fonts, type ColorTokens } from "../lib/theme";

const FONT_SIZE = 12.5;
const LINE_HEIGHT = 18;

/**
 * A script draft in a chat card: the assistant's marked lines read into
 * elements and set in a monospace face with each element's indent, as a
 * fraction of the card (from the shared page metrics), so a speech looks like a
 * speech and not a run of words. Chat width is not a 60 column page, so this
 * wraps; the page view is where a script is set exactly.
 */
export function ScriptDraft({ text, colors }: { text: string; colors: Pick<ColorTokens, "ink"> }) {
  const lines = useMemo(() => parseScriptLines(text), [text]);
  return (
    <View testID="script-draft">
      {lines.map((line, index) => {
        const element = normalizeElement(line.element);
        const metrics = ELEMENT_METRICS[element];
        const above = index > 0 ? normalizeElement(lines[index - 1].element) : null;
        const shown = element === "parenthetical" ? `(${line.text})` : metrics.caps ? line.text.toUpperCase() : line.text;
        return (
          <Text
            key={index}
            allowFontScaling
            style={[
              styles.line,
              {
                color: colors.ink,
                marginTop: above === null ? 0 : blankLinesBefore(element, above) * LINE_HEIGHT,
                paddingLeft: `${(metrics.indent / PAGE_COLUMNS) * 100}%`,
                paddingRight: `${((PAGE_COLUMNS - metrics.indent - metrics.width) / PAGE_COLUMNS) * 100}%`,
                textAlign: metrics.align,
                fontFamily: metrics.bold ? fonts.monoMedium : fonts.mono,
              },
            ]}
          >
            {shown}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT },
});
