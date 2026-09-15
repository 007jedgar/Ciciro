import { Stack } from "expo-router";
import { StackPopTransition } from "../../../../components/StackPopTransition";
import { useReduceMotion } from "../../../../lib/use-reduce-motion";

export default function StoryBibleStackLayout() {
  const reduceMotion = useReduceMotion();
  return (
    <Stack
      screenLayout={({ children }) => <StackPopTransition>{children}</StackPopTransition>}
      screenOptions={{
        headerShown: false,
        animation: reduceMotion ? "fade" : "none",
        animationDuration: reduceMotion ? 140 : 320,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen
        name="[...path]"
        // Same reason as the bible route itself: closing a file should show the
        // list it came from first, then the file folding away to the right.
        options={{ presentation: "transparentModal" }}
      />
    </Stack>
  );
}
