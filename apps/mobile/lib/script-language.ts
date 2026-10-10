import { useTranslation } from "react-i18next";
import { scriptLanguageSupported } from "./screenplay";

/**
 * Whether script formatting works in the language the app is in: English and
 * Spanish for now (Chinese and Hindi are planned). The phone knows only its
 * own language, so it is the one asked; the server also refuses a screenplay
 * PDF for a script written in another writing system.
 */
export function useScriptLanguageSupported(): boolean {
  const { i18n } = useTranslation();
  return scriptLanguageSupported(i18n.resolvedLanguage ?? i18n.language);
}
