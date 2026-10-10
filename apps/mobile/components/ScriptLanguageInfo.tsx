import { useTranslation } from "react-i18next";
import { InfoBubble } from "./InfoBubble";

/**
 * The little info button beside a script control that is grayed out because the
 * app is in a language script formatting does not support yet.
 */
export function ScriptLanguageInfo({ testID = "script-language-info" }: { testID?: string }) {
  const { t } = useTranslation();
  return (
    <InfoBubble
      testID={testID}
      accessibilityLabel={t("screenplay.languageInfo.label")}
      title={t("screenplay.languageInfo.title")}
      body={t("screenplay.languageInfo.body")}
    />
  );
}
