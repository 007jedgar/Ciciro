import { useRouter, useLocalSearchParams } from "expo-router";
import { demoForAnswers, wantsReminderStep } from "../lib/onboarding";
import { onboardingParams, parseOnboardingParams, stepsFor, type OnboardingParams } from "../lib/onboarding-flow";
import { FocusDemo } from "../components/onboarding/FocusDemo";
import { SuggestionsDemo } from "../components/onboarding/SuggestionsDemo";
import { getAnalytics } from "../lib/analytics-client";

/** The one demo the answers open - see `demoForAnswers` in lib/onboarding.ts. */
export default function OnboardingDemoScreen() {
  const router = useRouter();
  const state = parseOnboardingParams(
    useLocalSearchParams<OnboardingParams>()
  );
  const path = demoForAnswers(state.kind, state.obstacles);
  const steps = stepsFor(state.obstacles);

  function finish() {
    const params = onboardingParams(state);
    // People who said showing up is the hard part get the reminder form next.
    if (wantsReminderStep(state.obstacles)) router.push({ pathname: "/onboarding-reminder", params });
    else router.push({ pathname: "/signup", params });
  }

  function skip() {
    getAnalytics().track("onboarding_skipped", { step: "demos" });
    router.push({ pathname: "/signup", params: onboardingParams(state) });
  }

  if (path === "suggestions_not_overwrites") {
    return <SuggestionsDemo path={path} steps={steps} onContinue={finish} onSkip={skip} />;
  }
  return (
    <FocusDemo
      path={path}
      steps={steps}
      blankPage={state.kind === "journal"}
      onContinue={finish}
      onSkip={skip}
    />
  );
}
