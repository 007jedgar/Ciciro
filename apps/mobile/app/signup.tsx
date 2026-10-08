import { useLocalSearchParams } from "expo-router";
import { AuthScreen } from "../components/AuthScreen";
import { isManuscriptKind } from "../lib/manuscript-kind";
import { parseOnboardingParams, type OnboardingParams } from "../lib/onboarding-flow";

export default function SignupScreen() {
  const params = useLocalSearchParams<OnboardingParams>();
  // No kind means the quiz was skipped from its first screen: nothing to carry.
  const onboarding = isManuscriptKind(params.kind) ? parseOnboardingParams(params) : null;
  return <AuthScreen initialMode="signup" onboarding={onboarding} />;
}
