import { useCallback, useEffect } from "react";
import { View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { LivingPage } from "../components/LivingPage";
import { restoreLastPlace } from "../lib/last-place";
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

/**
 * Sends a signed-in author back to where they left off. Like `Redirect`, but
 * the manuscripts list goes on the stack first so the last place has a screen
 * under it to go back to.
 */
function RestoreLastPlace({ userId }: { userId: string }) {
  const router = useRouter();
  useFocusEffect(
    useCallback(() => {
      restoreLastPlace(router, userId);
    }, [router, userId])
  );
  return null;
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

  if (user) return <RestoreLastPlace userId={user.id} />;

  return (
    <LivingPage
      onCreate={() => router.push("/signup")}
      onSignIn={() => router.push("/login")}
    />
  );
}
