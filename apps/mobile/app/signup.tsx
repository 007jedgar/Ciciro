import { useLocalSearchParams } from "expo-router";
import { AuthScreen } from "../components/AuthScreen";
import { isManuscriptKind } from "../lib/manuscript-kind";
import { isObstacle } from "../lib/onboarding";

export default function SignupScreen() {
  const params = useLocalSearchParams<{ kind?: string; obstacle?: string }>();
  const onboarding = isManuscriptKind(params.kind)
    ? { kind: params.kind, obstacle: isObstacle(params.obstacle) ? params.obstacle : null }
    : null;
  return <AuthScreen initialMode="signup" onboarding={onboarding} />;
}
