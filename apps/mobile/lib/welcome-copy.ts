import { asStringList } from "./i18n";
import { MANUSCRIPT_KINDS, type ManuscriptKind } from "./manuscript-kind";
import type { WelcomeCopy } from "./welcome-script";

type Translate = (key: string, options?: Record<string, unknown>) => unknown;

/** The welcome screen's words in the current language (`welcome.*` in the locale files). */
export function welcomeCopy(t: Translate): WelcomeCopy {
  const text = (key: string) => String(t(`welcome.${key}`));
  const kinds = MANUSCRIPT_KINDS as readonly ManuscriptKind[];
  const words = {} as WelcomeCopy["words"];
  const cards = {} as WelcomeCopy["cards"];
  for (const kind of kinds) {
    words[kind] = text(`headline.words.${kind}`);
    cards[kind] = {
      label: text(`card.${kind}.label`),
      blocks: asStringList(t(`welcome.card.${kind}.blocks`, { returnObjects: true })),
    };
  }
  return {
    before: text("headline.before"),
    after: text("headline.after"),
    beforeFinal: text("headline.beforeFinal"),
    afterFinal: text("headline.afterFinal"),
    words,
    cards,
  };
}

/** How many lines the rewritten headline takes at its size, so the page holds still as the word changes. */
export function headlineLines(t: Translate): number {
  const lines = Number(t("welcome.headline.lines"));
  return Number.isFinite(lines) && lines >= 1 ? Math.round(lines) : 3;
}
