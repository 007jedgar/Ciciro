import { Alert } from "react-native";
import { isChapterEmpty } from "./html";

export type ChapterDeleteCopy = {
  blockedTitle: string;
  blockedMessage: string;
  cancel: string;
};

export type ChapterDeleteHost = {
  alert: typeof Alert.alert;
};

/**
 * An empty chapter goes straight to `onRemove` (the caller slides the row out
 * and offers Undo, so there is nothing to confirm); one that still has prose
 * is never deleted here, and the writer is told to empty it first.
 */
export function requestChapterDelete(
  chapter: { title: string; content?: string | null },
  copy: ChapterDeleteCopy,
  onRemove: () => void,
  host: ChapterDeleteHost = Alert
): void {
  if (!isChapterEmpty(chapter.content)) {
    host.alert(copy.blockedTitle, copy.blockedMessage, [{ text: copy.cancel, style: "cancel" }]);
    return;
  }
  onRemove();
}
