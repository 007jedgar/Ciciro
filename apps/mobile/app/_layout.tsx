import "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SessionProvider } from "../lib/session";
import { colors } from "../lib/theme";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <BottomSheetModalProvider>
          <SessionProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerTintColor: colors.accent,
                headerStyle: { backgroundColor: colors.panel },
                headerShadowVisible: false,
                contentStyle: { backgroundColor: colors.bg },
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="login" options={{ title: "Sign in" }} />
              <Stack.Screen name="signup" options={{ title: "Create account" }} />
              <Stack.Screen name="manuscripts" options={{ title: "Manuscripts" }} />
              <Stack.Screen name="new-manuscript" options={{ title: "New manuscript" }} />
              <Stack.Screen name="project/[id]" options={{ headerShown: false }} />
            </Stack>
          </SessionProvider>
        </BottomSheetModalProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
