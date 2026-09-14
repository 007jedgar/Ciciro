import { Alert } from "react-native";
import { isChapterEmpty } from "./html";

export type ChapterDeleteCopy = {
  blockedTitle: string;
  blockedMessage: string;
  deleteTitle: string;
  deleteMessage: string;
  cancel: string;
  delete: string;
};

export type ChapterDeleteHost = {
  alert: typeof Alert.alert;
};

/** Confirm a hard-delete for empty chapters; explain the empty-first rule otherwise. */
export function confirmChapterDelete(
  chapter: { title: string; content?: string | null },
  copy: ChapterDeleteCopy,
  onDelete: () => void,
  host: ChapterDeleteHost = Alert
): void {
  if (!isChapterEmpty(chapter.content)) {
    host.alert(copy.blockedTitle, copy.blockedMessage, [{ text: copy.cancel, style: "cancel" }]);
    return;
  }
  host.alert(copy.deleteTitle, copy.deleteMessage, [
    { text: copy.cancel, style: "cancel" },
    { text: copy.delete, style: "destructive", onPress: onDelete },
  ]);
}