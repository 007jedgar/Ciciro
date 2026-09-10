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
import { SettingsProvider, useAppTheme } from "../lib/settings";
import { LastPlaceTracker } from "../components/LastPlaceTracker";

function ThemedStack() {
  const { colors, dark } = useAppTheme();
  const { t } = useTranslation();
  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerTintColor: colors.accent,
          headerStyle: { backgroundColor: colors.panel },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
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
        <Stack.Screen name="settings" options={{ title: t("settings.title"), headerShown: false }} />
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
                <LastPlaceTracker />
                <ThemedStack />
              </SettingsProvider>
            </SessionProvider>
          </ApiQueryProvider>
        </BottomSheetModalProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
