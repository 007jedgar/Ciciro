import { useEffect } from "react";
import { View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { LivingPage } from "../components/LivingPage";
import { useAppTheme } from "../lib/settings";
import { useSession } from "../lib/session";

function BlinkingCursor({ color }: { color: string }) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(0, { duration: 530 }), -1, true);
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        { width: 3, height: 28, borderRadius: 1.5, backgroundColor: color },
        style,
      ]}
    />
  );
}

export default function WelcomeScreen() {
  const router = useRouter();
  const { user, ready } = useSession();
  const { colors } = useAppTheme();

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <BlinkingCursor color={colors.accent} />
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
