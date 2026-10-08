import { useCallback, useEffect, useState } from "react";
import { Text, type TextStyle, type StyleProp } from "react-native";
import { useReduceMotion } from "../../lib/use-reduce-motion";
import { useStackArrival } from "../../lib/stack-arrival";

/** The whole title writes itself in about this long, however long it is. */
const WRITE_MS = 640;
const MIN_CHAR_MS = 14;
const MAX_CHAR_MS = 34;

/**
 * A title that writes itself in as the screen arrives, a letter at a time. The
 * unwritten rest stays in the layout, invisible, so lines never rewrap while
 * it types. It always finishes (never loops), and with Reduce motion it is
 * simply there.
 */
export function WriteInTitle({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  const reduceMotion = useReduceMotion();
  const [count, setCount] = useState(reduceMotion ? text.length : 0);
  const [started, setStarted] = useState(false);
  const begin = useCallback(() => setStarted(true), []);
  useStackArrival(begin);

  useEffect(() => {
    if (reduceMotion) {
      setCount(text.length);
      return;
    }
    if (!started) return;
    setCount(0);
    const step = Math.min(MAX_CHAR_MS, Math.max(MIN_CHAR_MS, WRITE_MS / Math.max(1, text.length)));
    let shown = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      shown += 1;
      setCount(shown);
      if (shown < text.length) timer = setTimeout(tick, step);
    };
    // A short beat first, so the title starts as the screen settles under it.
    timer = setTimeout(tick, 120);
    return () => clearTimeout(timer);
  }, [started, reduceMotion, text]);

  return (
    <Text style={style} accessibilityLabel={text}>
      {text.slice(0, count)}
      <Text style={{ opacity: 0 }}>{text.slice(count)}</Text>
    </Text>
  );
}
