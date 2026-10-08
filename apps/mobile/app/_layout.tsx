import "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useTranslation } from "react-i18next";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ApiQueryProvider } from "../lib/api";
import "../lib/i18n";
import { SessionProvider } from "../lib/session";
import { useOptionalAppTheme } from "../lib/app-theme-context";
import { SettingsProvider } from "../lib/settings";
import { DEFAULT_THEME, THEME_PALETTES } from "../lib/theme";
import { LastPlaceTracker } from "../components/LastPlaceTracker";
import { AnalyticsSync } from "../components/AnalyticsSync";
import { PushRegistrationSync } from "../components/PushRegistrationSync";
import { WritingReminderSync } from "../components/WritingReminderSync";
import { WritingWidgetSync } from "../components/WritingWidgetSync";
import { ThemeWashScope } from "../components/ThemeWashScope";
import { StackPopTransition } from "../components/StackPopTransition";
import { arrivesSettled } from "../lib/stack-arrival";
import { SharedTitleMorphProvider } from "../lib/shared-title-morph";
import { UpdateSync } from "../components/UpdateSync";
import { entersWithStackPush, POP_OVER_STACK_SCREEN_OPTIONS } from "../lib/stack-pop";
import { WritingDayProvider } from "../lib/writing-day-session";
import { useReduceMotion } from "../lib/use-reduce-motion";

function ThemedStack() {
  const theme = useOptionalAppTheme();
  const colors = theme?.colors ?? THEME_PALETTES[DEFAULT_THEME];
  const dark = theme?.dark ?? false;
  const reduceMotion = useReduceMotion();
  const { t } = useTranslation();
  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenLayout={({ children, options, route }) => (
          <StackPopTransition enter={entersWithStackPush(options?.presentation) && !arrivesSettled(route)}>
            {children}
          </StackPopTransition>
        )}
        screenOptions={{
          headerTintColor: colors.accent,
          headerStyle: { backgroundColor: colors.panel },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: reduceMotion ? "fade" : "none",
          animationDuration: reduceMotion ? 140 : 320,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen
          name="login"
          options={{ headerShown: false, animation: "fade", animationDuration: 260 }}
        />
        <Stack.Screen
          name="signup"
          options={{ headerShown: false, animation: "fade", animationDuration: 260 }}
        />
        <Stack.Screen
          name="onboarding-goal"
          options={{ headerShown: false, animation: "fade", animationDuration: 260 }}
        />
        <Stack.Screen
          name="onboarding-obstacle"
          options={{ headerShown: false, animation: "fade", animationDuration: 260 }}
        />
        <Stack.Screen
          name="onboarding-look"
          options={{ headerShown: false, animation: "fade", animationDuration: 260 }}
        />
        <Stack.Screen
          name="onboarding-demo"
          options={{ headerShown: false, animation: "fade", animationDuration: 260 }}
        />
        <Stack.Screen
          name="onboarding-reminder"
          options={{ headerShown: false, animation: "fade", animationDuration: 260 }}
        />
        {/* Android's landing for a browser sign-in's ciciro://oauth deep link. */}
        <Stack.Screen name="oauth" options={{ headerShown: false, animation: "none" }} />
        <Stack.Screen
          name="forgot-password"
          options={{ title: t("auth.forgotTitle"), headerShown: false, ...POP_OVER_STACK_SCREEN_OPTIONS }}
        />
        <Stack.Screen name="manuscripts" options={{ title: t("manuscripts.title"), headerShown: false }} />
        <Stack.Screen
          name="new-manuscript"
          options={{
            title: t("newManuscript.title"),
            headerShown: false,
            ...POP_OVER_STACK_SCREEN_OPTIONS,
          }}
        />
        <Stack.Screen
          name="new-folder"
          options={{ title: t("newFolder.title"), headerShown: false, ...POP_OVER_STACK_SCREEN_OPTIONS }}
        />
        <Stack.Screen
          name="folder/[id]"
          options={{
            title: t("folder.fallbackTitle"),
            headerShown: false,
            ...POP_OVER_STACK_SCREEN_OPTIONS,
          }}
        />
        <Stack.Screen
          name="settings"
          options={{ title: t("settings.title"), headerShown: false, ...POP_OVER_STACK_SCREEN_OPTIONS }}
        />
        <Stack.Screen
          name="delete-account"
          options={{ title: t("account.deleteAccount"), headerShown: false, ...POP_OVER_STACK_SCREEN_OPTIONS }}
        />
        <Stack.Screen
          name="paywall"
          options={{ title: t("billing.title"), headerShown: false, ...POP_OVER_STACK_SCREEN_OPTIONS }}
        />
        <Stack.Screen
          name="writing-reminder"
          options={{
            title: t("reminders.title"),
            headerShown: false,
            ...POP_OVER_STACK_SCREEN_OPTIONS,
          }}
        />
        <Stack.Screen
          name="writing-reminders"
          options={{
            title: t("reminders.listTitle"),
            headerShown: false,
            ...POP_OVER_STACK_SCREEN_OPTIONS,
          }}
        />
        <Stack.Screen
          name="writing-history"
          options={{
            title: t("writingHistory.title"),
            headerShown: false,
            ...POP_OVER_STACK_SCREEN_OPTIONS,
          }}
        />
        <Stack.Screen
          name="project/[id]"
          options={{ headerShown: false, ...POP_OVER_STACK_SCREEN_OPTIONS }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <BottomSheetModalProvider>
          <ApiQueryProvider>
            <SessionProvider>
              <SettingsProvider>
                <WritingDayProvider>
                  <LastPlaceTracker />
                  <AnalyticsSync />
                  <WritingReminderSync />
                  <PushRegistrationSync />
                  <WritingWidgetSync />
                  <UpdateSync />
                  <SharedTitleMorphProvider>
                    <ThemeWashScope style={{ flex: 1 }}>
                      <ThemedStack />
                    </ThemeWashScope>
                  </SharedTitleMorphProvider>
                </WritingDayProvider>
              </SettingsProvider>
            </SessionProvider>
          </ApiQueryProvider>
        </BottomSheetModalProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
