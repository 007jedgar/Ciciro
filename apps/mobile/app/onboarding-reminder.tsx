import { useRef, useState } from "react";
import { Linking, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { OnboardingFrame, Rise } from "../components/onboarding/OnboardingFrame";
import { TapPressable } from "../components/TapPressable";
import { WritingReminderForm } from "../components/WritingReminderForm";
import { getAnalytics } from "../lib/analytics-client";
import {
  onboardingParams,
  onboardingReminderDraft,
  parseOnboardingParams,
  stepsFor,
} from "../lib/onboarding-flow";
import { useAppTheme } from "../lib/settings";
import { useStackBack } from "../lib/use-stack-back";
import { requestReminderPermission } from "../lib/writing-reminder-notifications";
import { reminderSaveOutcome } from "../lib/writing-reminder-sync";
import { createWritingReminderId, type WritingReminder } from "../lib/writing-reminders";

/**
 * Shown after the demo to anyone who picked "Sitting down consistently": the
 * real reminder form, and the iOS notification prompt on Create reminder. There
 * is no account yet, so the reminder is held in the route params and saved and
 * scheduled by `AuthScreen` only if the sign-up creates one - see AGENTS.md
 * "Pre-signup onboarding". Free for everyone; nothing here checks an entitlement.
 */
export default function OnboardingReminderScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { layout } = useAppTheme();
  const state = parseOnboardingParams(
    useLocalSearchParams<{ kind?: string; obstacles?: string; theme?: string; reminder?: string }>()
  );
  const draft = useRef<WritingReminder>(state.reminder ?? onboardingReminderDraft(createWritingReminderId())).current;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showOpenSettings, setShowOpenSettings] = useState(false);
  const deniedNoticeShown = useRef(false);

  function toSignup(reminder: WritingReminder | null) {
    router.push({ pathname: "/signup", params: onboardingParams({ ...state, reminder }) });
  }

  async function create(next: WritingReminder) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setShowOpenSettings(false);
    const permission = await requestReminderPermission(t("reminders.channel"));
    setBusy(false);
    getAnalytics().track("onboarding_reminder_created", {
      permission: permission === "granted" ? "granted" : permission === "unavailable" ? "unavailable" : "denied",
    });
    // Denied or not, the reminder is kept: it is saved with the account and
    // starts working the moment notifications are turned on in iOS Settings.
    const outcome = reminderSaveOutcome({
      permission,
      published: permission === "granted" ? "scheduled" : permission === "unavailable" ? "unavailable" : "skipped",
      deniedNoticeShown: deniedNoticeShown.current,
    });
    switch (outcome.action) {
      case "denied-notice":
        deniedNoticeShown.current = true;
        setNotice(t("onboarding.reminderDenied"));
        setShowOpenSettings(true);
        return;
      case "unavailable-notice":
        // Nothing to turn on in Settings: say so once, then let the next press through.
        if (deniedNoticeShown.current) {
          toSignup(next);
          return;
        }
        deniedNoticeShown.current = true;
        setNotice(t("reminders.savedUnavailable"));
        return;
      default:
        toSignup(next);
    }
  }

  function notNow() {
    getAnalytics().track("onboarding_skipped", { step: "reminder" });
    toSignup(null);
  }

  return (
    <OnboardingFrame
      steps={stepsFor(state.obstacles)}
      step="reminder"
      title={t("onboarding.reminderTitle")}
      body={t("onboarding.reminderBody")}
      onBack={() => backOr("/")}
      onSkip={notNow}
    >
      <Rise index={2}>
        <WritingReminderForm
          onboarding
          reminder={draft}
          manuscripts={[]}
          busy={busy}
          notice={notice}
          openSettingsLabel={showOpenSettings ? t("reminders.openSettings") : null}
          onOpenSettings={showOpenSettings ? () => void Linking.openSettings() : undefined}
          onSave={(next) => void create(next)}
        />
        <TapPressable
          style={layout.ghostBtn}
          onPress={notNow}
          accessibilityRole="button"
          accessibilityLabel={t("onboarding.reminderNotNow")}
        >
          <Text style={layout.ghostBtnText}>{t("onboarding.reminderNotNow")}</Text>
        </TapPressable>
      </Rise>
    </OnboardingFrame>
  );
}
