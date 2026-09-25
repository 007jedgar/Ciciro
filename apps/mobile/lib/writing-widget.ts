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
