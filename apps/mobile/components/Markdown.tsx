import { useEffect, useMemo } from "react";
import { StyleSheet, Text, View, type TextStyle } from "react-native";
import Animated, {
  cancelAnimation,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { blockText, parseMarkdown, type InlineSpan, type MarkdownBlock } from "../lib/markdown";
import type { ColorTokens } from "../lib/theme";

const WORD_FADE_MS = 240;
const BLOCK_STAGGER_MS = 40;

/**
 * One run of words. While a reply is streaming each freshly mounted run fades
 * up, so text arrives like ink taking rather than snapping into place. Opacity
 * is the only property animated — it is the one transform nested <Text> honours
 * on both platforms, and if a platform ignores it the words simply appear.
 */
function Run({
  span,
  style,
  animate,
}: {
  span: InlineSpan;
  style: TextStyle;
  animate: boolean;
}) {
  const fade = useSharedValue(animate ? 0 : 1);
  const animated = useAnimatedStyle(() => ({ opacity: fade.value }));

  useEffect(() => {
    if (animate) fade.value = withTiming(1, { duration: WORD_FADE_MS });
    else fade.value = 1;
  }, [animate, fade]);

  return <Animated.Text style={[style, animated]}>{span.text}</Animated.Text>;
}

/** A soft bar that pulses where the editor is still writing. */
function Caret({ color }: { color: string }) {
  const pulse = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(withTiming(0.15, { duration: 520 }), withTiming(1, { duration: 520 })),
      -1,
      false
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  return <Animated.View style={[styles.caret, { backgroundColor: color }, style]} />;
}

function spanStyle(span: InlineSpan, colors: ColorTokens, base: TextStyle): TextStyle {
  return {
    ...base,
    ...(span.bold ? { fontWeight: "700" } : null),
    ...(span.italic ? { fontStyle: "italic" } : null),
    ...(span.strike ? { textDecorationLine: "line-through" } : null),
    ...(span.href ? { color: colors.accent, textDecorationLine: "underline" } : null),
    ...(span.code
      ? {
          fontFamily: "Menlo",
          fontSize: (base.fontSize ?? 16) - 1,
          color: colors.draft,
        }
      : null),
  };
}

/**
 * Split a run on word boundaries so each word can mount — and so fade in —
 * on its own. Trailing whitespace stays attached to the word before it, which
 * keeps line breaking identical to rendering the run whole.
 */
function words(span: InlineSpan): InlineSpan[] {
  const parts = span.text.match(/\S+\s*|\s+/g);
  if (!parts) return [];
  return parts.map((text) => ({ ...span, text }));
}

function Line({
  spans,
  colors,
  base,
  reveal,
  caret,
}: {
  spans: InlineSpan[];
  colors: ColorTokens;
  base: TextStyle;
  /** Split into words and fade each one in as it mounts. */
  reveal: boolean;
  caret: boolean;
}) {
  return (
    <Text style={base}>
      {spans.flatMap((span, spanIndex) =>
        (reveal ? words(span) : [span]).map((run, runIndex) => (
          <Run
            key={`${spanIndex}:${runIndex}`}
            span={run}
            style={spanStyle(run, colors, base)}
            animate={reveal}
          />
        ))
      )}
      {caret ? <Caret color={colors.accent} /> : null}
    </Text>
  );
}

function Block({
  block,
  colors,
  animate,
  reveal,
  caret,
  index,
}: {
  block: MarkdownBlock;
  colors: ColorTokens;
  animate: boolean;
  reveal: boolean;
  caret: boolean;
  index: number;
}) {
  const body: TextStyle = { color: colors.ink, fontSize: 16, lineHeight: 25 };
  const entering = animate
    ? FadeInDown.duration(260).delay(Math.min(index, 6) * BLOCK_STAGGER_MS)
    : undefined;

  if (block.kind === "rule") {
    return (
      <Animated.View
        entering={entering}
        style={[styles.rule, { backgroundColor: colors.line }]}
      />
    );
  }

  if (block.kind === "code") {
    return (
      <Animated.View
        entering={entering}
        style={[styles.code, { backgroundColor: colors.panel2, borderColor: colors.line }]}
      >
        <Text
          style={{ fontFamily: "Menlo", fontSize: 13, lineHeight: 20, color: colors.ink }}
        >
          {block.text}
        </Text>
      </Animated.View>
    );
  }

  if (block.kind === "heading") {
    const sizes = [23, 20, 18, 17, 16, 16];
    return (
      <Animated.View entering={entering} style={styles.heading}>
        <Line
          spans={block.spans}
          colors={colors}
          base={{
            color: colors.ink,
            fontSize: sizes[block.level - 1] ?? 16,
            lineHeight: (sizes[block.level - 1] ?? 16) + 8,
            fontWeight: "700",
          }}
          reveal={reveal}
          caret={caret}
        />
      </Animated.View>
    );
  }

  if (block.kind === "quote") {
    return (
      <Animated.View entering={entering} style={styles.quoteRow}>
        <View style={[styles.quoteBar, { backgroundColor: colors.accent }]} />
        <View style={styles.quoteBody}>
          <Line
            spans={block.spans}
            colors={colors}
            base={{ ...body, color: colors.inkSoft, fontStyle: "italic" }}
            reveal={reveal}
            caret={caret}
          />
        </View>
      </Animated.View>
    );
  }

  if (block.kind === "listItem") {
    return (
      <Animated.View entering={entering} style={styles.listRow}>
        <Text style={[body, styles.marker, { color: colors.inkSoft }]}>{block.marker}</Text>
        <View style={styles.listBody}>
          <Line spans={block.spans} colors={colors} base={body} reveal={reveal} caret={caret} />
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={entering} style={styles.paragraph}>
      <Line spans={block.spans} colors={colors} base={body} reveal={reveal} caret={caret} />
    </Animated.View>
  );
}

/**
 * Ciciro's prose, rendered as prose. No bubble, no card — the reply is the page,
 * so markdown the editor sent (headings, lists, emphasis) reads as formatting
 * rather than as stray asterisks.
 */
export function Markdown({
  source,
  colors,
  animate = false,
  caret = false,
}: {
  source: string;
  colors: ColorTokens;
  /** Fade freshly arrived words and blocks in — on while a reply streams. */
  animate?: boolean;
  /** Show the writing caret after the final block. */
  caret?: boolean;
}) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  if (blocks.length === 0) return null;
  const label = blocks.map(blockText).filter(Boolean).join("\n\n");

  return (
    <Animated.View
      accessible
      accessibilityLabel={label}
      entering={animate ? FadeIn.duration(180) : undefined}
    >
      {blocks.map((block, index) => (
        <Block
          key={index}
          block={block}
          colors={colors}
          animate={animate}
          // Only the block being written reveals word by word. Blocks above it
          // are settled prose, and splitting them would re-render every word on
          // every chunk for no visible gain.
          reveal={animate && index === blocks.length - 1}
          caret={caret && index === blocks.length - 1}
          index={index}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  paragraph: { marginTop: 8 },
  heading: { marginTop: 16, marginBottom: 2 },
  listRow: { flexDirection: "row", marginTop: 6, paddingRight: 4 },
  marker: { width: 24 },
  listBody: { flex: 1 },
  quoteRow: { flexDirection: "row", marginTop: 10 },
  quoteBar: { width: 2, borderRadius: 1, marginRight: 12 },
  quoteBody: { flex: 1 },
  code: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 16 },
  caret: {
    width: 2,
    height: 15,
    borderRadius: 1,
    marginLeft: 3,
    transform: [{ translateY: 2 }],
  },
});
