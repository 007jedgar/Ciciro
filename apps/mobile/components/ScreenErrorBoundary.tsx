import { Component, type ReactNode } from "react";
import { View } from "react-native";
import i18n from "../lib/i18n";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchment, makeLayout } from "../lib/theme";
import { ScreenErrorState } from "./ScreenErrorState";

/**
 * Catches a render crash in the subtree (manuscripts, a manuscript's
 * chapters) and shows the same recovery UI a failed fetch would, instead of
 * a dead screen. `i18n.t` runs outside the hook tree here on purpose - a
 * class component has no `useTranslation` - matching the direct-`i18n.t`
 * pattern `lib/api/client.ts` already uses for error text built outside React.
 */
type Props = { children: ReactNode };
type State = { error: Error | null; retriedOnce: boolean };

export class ScreenErrorBoundary extends Component<Props, State> {
  state: State = { error: null, retriedOnce: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  private handleRetry = () => {
    this.setState((s) => ({ error: null, retriedOnce: true }));
  };

  render() {
    if (this.state.error) {
      return (
        <ScreenErrorBoundaryFallback
          detail={this.state.error.message}
          showRestart={this.state.retriedOnce}
          onRetry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}

function ScreenErrorBoundaryFallback({
  detail,
  showRestart,
  onRetry,
}: {
  detail: string;
  showRestart: boolean;
  onRetry: () => void;
}) {
  const theme = useOptionalAppTheme();
  const layout = theme?.layout ?? makeLayout(parchment);
  return (
    <View style={[layout.screen, { justifyContent: "center" }]}>
      <ScreenErrorState
        message={i18n.t("errors.screenCrashed")}
        detail={detail}
        onRetry={onRetry}
        showRestart={showRestart}
      />
    </View>
  );
}
