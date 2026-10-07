import { useRouter, useLocalSearchParams } from "expo-router";
import { normalizeKind } from "../lib/manuscript-kind";
import { demoForObstacle, isObstacle } from "../lib/onboarding";
import { FocusDemo } from "../components/onboarding/FocusDemo";
import { SuggestionsDemo } from "../components/onboarding/SuggestionsDemo";
import { getAnalytics } from "../lib/analytics-client";

/** The one demo a Q2 answer opens - see `demoForObstacle` in lib/onboarding.ts. */
export default function OnboardingDemoScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string; obstacle?: string }>();
  const kind = normalizeKind(params.kind);
  const obstacle = isObstacle(params.obstacle) ? params.obstacle : "unsure";
  const path = demoForObstacle(obstacle);

  function finish() {
    router.push({ pathname: "/signup", params: { kind, obstacle } });
  }

  function skip() {
    getAnalytics().track("onboarding_skipped", { step: "demos" });
    router.push({ pathname: "/signup", params: { kind, obstacle } });
  }

  if (path === "suggestions_not_overwrites") {
    return <SuggestionsDemo path={path} onContinue={finish} onSkip={skip} />;
  }
  return <FocusDemo path={path} onContinue={finish} onSkip={skip} />;
}
