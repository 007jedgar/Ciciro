import { ActivityIndicator, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { LivingPage } from "../components/LivingPage";
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

  if (user) return <Redirect href="/manuscripts" />;

  return (
    <LivingPage
      onCreate={() => router.push("/signup")}
      onSignIn={() => router.push("/login")}
    />
  );
}
