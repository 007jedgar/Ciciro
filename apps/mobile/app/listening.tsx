import { Redirect } from "expo-router";
import { ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppHeader, useMeasuredAppHeaderHeight } from "../components/AppHeader";
import { ListeningSettings } from "../components/ListeningSettings";
import { ScreenErrorBoundary } from "../components/ScreenErrorBoundary";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";
import { useStackBack } from "../lib/use-stack-back";

/**
 * Who reads a chapter aloud: the phone's own voices or the natural voice that is
 * downloaded once and runs on the phone. Reached from Settings and from the
 * voice row on the Listen screen.
 */
function ListeningScreen() {
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { user, ready } = useSession();
  const { layout } = useAppTheme();
  const [headerHeight, onHeaderHeight] = useMeasuredAppHeaderHeight();

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  return (
    <View style={layout.screen}>
      <AppHeader title={t("listening.title")} onBack={() => backOr("/settings")} floating onHeightChange={onHeaderHeight} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: headerHeight + 8, paddingBottom: 40 }}
        scrollIndicatorInsets={{ top: headerHeight }}
      >
        <ListeningSettings />
      </ScrollView>
    </View>
  );
}

export default function ListeningRoute() {
  return (
    <ScreenErrorBoundary>
      <ListeningScreen />
    </ScreenErrorBoundary>
  );
}
