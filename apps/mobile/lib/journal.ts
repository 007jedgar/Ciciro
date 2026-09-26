import { findEntryForDate, journalEntryTitle, localYmd } from "./manuscript-kind";

type EntryChapter = { id: string; title: string };

/**
 * "New entry for today": the chapter dated today if the journal already has
 * one, otherwise a new chapter titled with today's date. Running it twice in a
 * day never makes a second entry.
 */
export async function openTodayEntry<T extends EntryChapter>(
  chapters: readonly T[],
  addChapter: (title: string) => Promise<T>,
  select: (id: string) => void,
  today: string = localYmd()
): Promise<T> {
  const existing = findEntryForDate([...chapters], today);
  if (existing) {
    select(existing.id);
    return existing;
  }
  const created = await addChapter(journalEntryTitle(today));
  select(created.id);
  return created;
}
