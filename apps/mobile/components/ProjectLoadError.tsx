import { useState } from "react";
import { View } from "react-native";
import { useAppHeaderHeight } from "./AppHeader";
import { ScreenErrorState } from "./ScreenErrorState";
import { useAppTheme } from "../lib/settings";

/**
 * A manuscript tab whose project failed to load: the shared recovery state
 * (message, Try again, Restart app after a retry has failed) under the floating
 * header, wired to the project's own reload.
 */
export function ProjectLoadError({
  message,
  detail,
  reload,
}: {
  message: string;
  detail: string | null;
  reload: () => Promise<boolean>;
}) {
  const { layout } = useAppTheme();
  const headerHeight = useAppHeaderHeight();
  const [retrying, setRetrying] = useState(false);
  const [retryAttempted, setRetryAttempted] = useState(false);

  async function retry() {
    setRetrying(true);
    const loaded = await reload();
    setRetrying(false);
    setRetryAttempted(!loaded);
  }

  return (
    <View style={[layout.padded, { paddingTop: headerHeight + 16 }]}>
      <ScreenErrorState
        variant="full"
        message={message}
        detail={detail}
        onRetry={() => void retry()}
        retrying={retrying}
        showRestart={retryAttempted}
      />
    </View>
  );
}
