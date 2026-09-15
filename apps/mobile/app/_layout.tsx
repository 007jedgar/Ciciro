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
import { THEME_PALETTES } from "../lib/theme";
import { LastPlaceTracker } from "../components/LastPlaceTracker";
import { StackPopTransition } from "../components/StackPopTransition";
import { WritingDayProvider } from "../lib/writing-day-session";
import { useReduceMotion } from "../lib/use-reduce-motion";

function ThemedStack() {
  const theme = useOptionalAppTheme();
  const colors = theme?.colors ?? THEME_PALETTES.parchment;
  const dark = theme?.dark ?? false;
  const reduceMotion = useReduceMotion();
  const { t } = useTranslation();
  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenLayout={({ children }) => <StackPopTransition>{children}</StackPopTransition>}
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
        <Stack.Screen name="manuscripts" options={{ title: t("manuscripts.title"), headerShown: false }} />
        <Stack.Screen name="new-manuscript" options={{ title: t("newManuscript.title"), headerShown: false }} />
        <Stack.Screen name="new-folder" options={{ title: t("newFolder.title"), headerShown: false }} />
        <Stack.Screen name="folder/[id]" options={{ title: t("folder.fallbackTitle"), headerShown: false }} />
        <Stack.Screen
          name="settings"
          options={{
            title: t("settings.title"),
            headerShown: false,
            // Presented over the stack rather than in place of it, so the screen
            // being returned to is already on show underneath while settings
            // collapses away over it. A pushed card detaches what is below it,
            // and the collapse then plays against an empty background.
            presentation: "transparentModal",
            // The page colour comes from the collapsing view itself (see
            // StackPopTransition), so nothing opaque is left standing over the
            // screen underneath once the collapse starts.
            contentStyle: { backgroundColor: "transparent" },
          }}
        />
        <Stack.Screen name="project/[id]" options={{ headerShown: false }} />
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
                  <ThemedStack />
                </WritingDayProvider>
              </SettingsProvider>
            </SessionProvider>
          </ApiQueryProvider>
        </BottomSheetModalProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
