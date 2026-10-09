import type { ReactNode } from "react";
import { View } from "react-native";
import { ThemeWashScope } from "../ThemeWashScope";
import { FocusCollapse } from "./FocusCollapse";
import { CarryOverlay } from "./CarryOverlay";
import { OnboardingHeader } from "./OnboardingHeader";
import { OnboardingThread } from "./OnboardingThread";
import { StoryChips } from "./StoryChips";
import { OnboardingShellProvider, useOnboardingShell, type Measurable } from "../../lib/onboarding-shell";
import { useAppTheme } from "../../lib/settings";

/**
 * Everything the onboarding screens share, which none of them re-mounts as the
 * steps change: the wash scope for Pick a look, the header (back, the progress
 * thread, Skip) with the row of answer chips under it, and, above the screens,
 * the cards in flight to those chips. `children` is the navigator that shows
 * one screen at a time. See `lib/onboarding-shell.tsx`.
 */
export function OnboardingShell({ children }: { children: ReactNode }) {
  return (
    <OnboardingShellProvider>
      <ShellBody>{children}</ShellBody>
    </OnboardingShellProvider>
  );
}

function ShellBody({ children }: { children: ReactNode }) {
  const { layout } = useAppTheme();
  const { step, steps, focus, headerHeight, focusHidden, carrying, back, skip, registerRoot } = useOnboardingShell();
  // Its own wash scope, above the screens: the root's snapshot cannot see a
  // native-stack screen's contents (it comes back black), so Pick a look washes
  // within the onboarding's own view, header and all.
  return (
    <ThemeWashScope style={layout.screen}>
      <View
        ref={(node) => registerRoot(node as unknown as Measurable | null)}
        collapsable={false}
        pointerEvents={carrying ? "none" : "auto"}
        style={{ flex: 1 }}
      >
        {/* Closes up behind the focus demo's focus mode, as the page takes its place. */}
        <FocusCollapse progress={focus} natural={headerHeight} direction={-1} hidden={focusHidden}>
          <OnboardingHeader onBack={back} onSkip={skip} thread={<OnboardingThread steps={steps} current={step} />} />
          <StoryChips />
        </FocusCollapse>
        <View style={{ flex: 1 }}>{children}</View>
        <CarryOverlay />
      </View>
    </ThemeWashScope>
  );
}
