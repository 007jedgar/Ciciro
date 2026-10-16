import { useRouter, useLocalSearchParams } from "expo-router";
import { demoForAnswers } from "../../lib/onboarding";
import { onboardingParams, parseOnboardingParams, pathAfter, stepsFor, type OnboardingParams } from "../../lib/onboarding-flow";
import { FocusDemo } from "../../components/onboarding/FocusDemo";
import { SuggestionsDemo } from "../../components/onboarding/SuggestionsDemo";
import { ScreenplayDemo } from "../../components/onboarding/ScreenplayDemo";
import { getAnalytics } from "../../lib/analytics-client";

/** The one demo the answers open - see `demoForAnswers` in lib/onboarding.ts. */
export default function OnboardingDemoScreen() {
  const router = useRouter();
  const state = parseOnboardingParams(
    useLocalSearchParams<OnboardingParams>()
  );
  const path = demoForAnswers(state.kind, state.obstacles);
  const steps = stepsFor(state.obstacles);

  // Writer's block and creativity hear about the exercises next, then
  // people who said showing up is the hard part get the reminder form.
  function finish() {
    router.push({ pathname: pathAfter("demo", state.obstacles), params: onboardingParams(state) });
  }

  function skip() {
    getAnalytics().track("onboarding_skipped", { step: "demos" });
    router.push({ pathname: "/signup", params: onboardingParams(state) });
  }

  if (path === "suggestions_not_overwrites") {
    return <SuggestionsDemo path={path} steps={steps} onContinue={finish} onSkip={skip} />;
  }
  if (path === "screenplay_scene") {
    return <ScreenplayDemo path={path} steps={steps} onContinue={finish} onSkip={skip} />;
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
