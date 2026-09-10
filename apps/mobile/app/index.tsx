import { ActivityIndicator, View } from "react-native";
import { Redirect, useRouter, type Href } from "expo-router";
import { LivingPage } from "../components/LivingPage";
import { restoreHref } from "../lib/last-place";
import { useAppTheme } from "../lib/settings";
import { useSession } from "../lib/session";

export default function WelcomeScreen() {
  const router = useRouter();
  const { user, ready } = useSession();
  const { colors } = useAppTheme();

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (user) return <Redirect href={restoreHref(user.id) as Href} />;

  return (
    <LivingPage
      onCreate={() => router.push("/signup")}
      onSignIn={() => router.push("/login")}
    />
  );
}
