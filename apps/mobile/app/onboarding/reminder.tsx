import { useRef, useState } from "react";
import { Linking, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { OnboardingFrame, Rise } from "../../components/onboarding/OnboardingFrame";
import { useCarryLooks } from "../../components/onboarding/carry-looks";
import { TapPressable } from "../../components/TapPressable";
import { WritingReminderForm } from "../../components/WritingReminderForm";
import { getAnalytics } from "../../lib/analytics-client";
import {
  onboardingParams,
  onboardingReminderDraft,
  parseOnboardingParams,
  stepsFor,
  type OnboardingParams,
} from "../../lib/onboarding-flow";
import { useAppTheme } from "../../lib/settings";
import { useStackBack } from "../../lib/use-stack-back";
import { useCarry, useCarryNodes } from "../../lib/onboarding-shell";
import { reminderChipLabel } from "../../lib/onboarding-story";
import { requestReminderPermission } from "../../lib/writing-reminder-notifications";
import { reminderSaveOutcome } from "../../lib/writing-reminder-sync";
import { createWritingReminderId, type WritingReminder } from "../../lib/writing-reminders";

/**
 * Shown after the demo to anyone who picked "Sitting down consistently": the
 * real reminder form, and the iOS notification prompt on Create reminder. There
 * is no account yet, so the reminder is held in the route params and saved and
 * scheduled by `AuthScreen` only if the sign-up creates one - see AGENTS.md
 * "Pre-signup onboarding". Free for everyone; nothing here checks an entitlement.
 */
/** One frame on, so a state just set (the button back to "Create reminder") has been drawn. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export default function OnboardingReminderScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t, i18n } = useTranslation();
  const { layout } = useAppTheme();
  const carry = useCarry();
  const nodes = useCarryNodes();
  const looks = useCarryLooks();
  const state = parseOnboardingParams(
    useLocalSearchParams<OnboardingParams>()
  );
  const draft = useRef<WritingReminder>(state.reminder ?? onboardingReminderDraft(createWritingReminderId())).current;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showOpenSettings, setShowOpenSettings] = useState(false);
  const deniedNoticeShown = useRef(false);

  async function toSignup(reminder: WritingReminder | null) {
    if (reminder) {
      // The button settles into the last chip before signup, which this screen does not
      // outlive: the chip has landed by the time the sign-up screen fades in.
      await nextFrame();
      const source = nodes.get("reminder");
      const label = reminderChipLabel(reminder, i18n.language, (key, options) => String(t(key, options)));
      const flying = await carry.fly(
        [
          {
            chip: { id: "reminder", step: "reminder", label },
            card: source.card,
            title: source.title,
            look: looks.button(t("onboarding.reminderCreate")),
          },
        ],
        { settle: true }
      );
      if (!flying) return;
    }
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
          void toSignup(next);
          return;
        }
        deniedNoticeShown.current = true;
        setNotice(t("reminders.savedUnavailable"));
        return;
      default:
        void toSignup(next);
    }
  }

  function notNow() {
    getAnalytics().track("onboarding_skipped", { step: "reminder" });
    void toSignup(null);
  }

  return (
    <OnboardingFrame
      steps={stepsFor(state.obstacles)}
      step="reminder"
      title={t("onboarding.reminderTitle")}
      body={t("onboarding.reminderBody")}
      onBack={() => backOr("/")}
      onSkip={notNow}
      leave={carry.fadeStyle}
    >
      <Rise index={2}>
        <WritingReminderForm
          onboarding
          reminder={draft}
          manuscripts={[]}
          saveRef={nodes.cardRef("reminder")}
          saveLabelRef={nodes.titleRef("reminder")}
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
