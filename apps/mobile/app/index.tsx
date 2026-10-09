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
import { useThemePreview } from "../lib/theme-preview-context";
import { useReduceMotion } from "../lib/use-reduce-motion";

function BlinkingCursor({ color }: { color: string }) {
  const reduceMotion = useReduceMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    // Under reduce motion the cursor stays lit rather than blinking forever.
    if (reduceMotion) {
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(withTiming(0, { duration: 530 }), -1, true);
  }, [opacity, reduceMotion]);

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
  const { setPreview } = useThemePreview();

  // Coming back to Welcome from the onboarding drops the look it was trying on.
  useFocusEffect(
    useCallback(() => {
      setPreview(null);
    }, [setPreview])
  );

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
      onCreate={() => router.push("/onboarding/goal")}
      onSignIn={() => router.push("/login")}
    />
  );
}
