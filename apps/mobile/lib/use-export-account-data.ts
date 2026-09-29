import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { ExportUnavailableError, exportAccountData } from "./account-data";

/** "Export my data" for a settings row or button: one run at a time, failures as an alert. */
export function useExportAccountData(): { busy: boolean; run: () => void } {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const run = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    void exportAccountData()
      .catch((error: unknown) => {
        Alert.alert(
          t("account.exportFailed"),
          error instanceof ExportUnavailableError
            ? t("account.exportUnavailable")
            : t("account.exportRetry")
        );
      })
      .finally(() => {
        running.current = false;
        setBusy(false);
      });
  }, [t]);

  return { busy, run };
}
