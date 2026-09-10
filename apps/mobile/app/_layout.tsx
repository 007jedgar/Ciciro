import "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SessionProvider } from "../lib/session";
import { SettingsProvider, useAppTheme } from "../lib/settings";

function ThemedStack() {
  const { colors, dark } = useAppTheme();
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
        <Stack.Screen name="manuscripts" options={{ title: "Manuscripts", headerShown: false }} />
        <Stack.Screen name="new-manuscript" options={{ title: "New manuscript" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
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
          <SessionProvider>
            <SettingsProvider>
              <ThemedStack />
            </SettingsProvider>
          </SessionProvider>
        </BottomSheetModalProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
