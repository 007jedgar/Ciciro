import { Platform } from "react-native";
import { hrefForLastPlace, type LastPlace } from "./last-place";
import type { WritingDayWidgetProps } from "../widgets/WritingDayWidget";

export type WritingWidgetSnapshot = {
  words: number;
  goal: number;
  daysInLast7: number;
  openHref: string;
};

/** Deep link the widget uses to reopen the last reading place. */
export function widgetOpenUrl(href: string): string {
  const path = href.startsWith("/") ? href : `/${href}`;
  return `ciciro://${path}`;
}

export function buildWritingWidgetSnapshot(input: {
  words: number;
  goal: number;
  daysInLast7: number;
  lastPlace: LastPlace | null;
}): WritingWidgetSnapshot {
  return {
    words: Math.max(0, Math.floor(input.words)),
    goal: Math.max(0, Math.floor(input.goal)),
    daysInLast7: Math.max(0, Math.min(7, Math.floor(input.daysInLast7))),
    openHref: hrefForLastPlace(input.lastPlace),
  };
}

/**
 * The widget's native layout is only registered (written into the shared app
 * group's storage) as a side effect of importing `widgets/WritingDayWidget`,
 * which happens the first time something publishes a snapshot. Without
 * someone signed in to read real data from, this is what keeps the widget
 * showing a sane zero state (and, critically, keeps the layout registered at
 * all) on a fresh install and after sign-out, instead of leaving the
 * extension with no layout to render.
 */
export const SIGNED_OUT_WIDGET_SNAPSHOT: WritingWidgetSnapshot = buildWritingWidgetSnapshot({
  words: 0,
  goal: 0,
  daysInLast7: 0,
  lastPlace: null,
});

export function snapshotEquals(
  a: WritingWidgetSnapshot | null,
  b: WritingWidgetSnapshot
): boolean {
  if (!a) return false;
  return (
    a.words === b.words &&
    a.goal === b.goal &&
    a.daysInLast7 === b.daysInLast7 &&
    a.openHref === b.openHref
  );
}

export function toWidgetProps(snapshot: WritingWidgetSnapshot): WritingDayWidgetProps {
  return {
    words: snapshot.words,
    goal: snapshot.goal,
    daysInLast7: snapshot.daysInLast7,
    openUrl: widgetOpenUrl(snapshot.openHref),
  };
}

let lastPublished: WritingWidgetSnapshot | null = null;

/** Publish a home/lock-screen widget snapshot when today or the 7-day count changes. */
export async function publishWritingWidgetSnapshot(
  snapshot: WritingWidgetSnapshot
): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  if (snapshotEquals(lastPublished, snapshot)) return false;
  try {
    const WritingDayWidget = (await import("../widgets/WritingDayWidget")).default;
    WritingDayWidget.updateSnapshot(toWidgetProps(snapshot));
    lastPublished = snapshot;
    return true;
  } catch {
    /* Expo Go / missing native module until a dev-client rebuild */
    return false;
  }
}

/** Test helper. */
export function resetWritingWidgetPublishStateForTests(): void {
  lastPublished = null;
}
