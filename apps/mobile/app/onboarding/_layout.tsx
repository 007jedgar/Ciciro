import { Stack } from "expo-router";
import { OnboardingShell } from "../../components/onboarding/OnboardingShell";
import { useAppTheme } from "../../lib/settings";

/**
 * The pre-signup quiz, one navigator under one shell: the header and the row of
 * answer chips sit above it and stay put while the steps change beneath them
 * (see `OnboardingShell`). Each step arrives the way it always has - a fade, with
 * its own content rising in.
 */
export default function OnboardingLayout() {
  const { colors } = useAppTheme();
  return (
    <OnboardingShell>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "fade",
          animationDuration: 260,
          contentStyle: { backgroundColor: colors.bg },
        }}
      />
    </OnboardingShell>
  );
}
