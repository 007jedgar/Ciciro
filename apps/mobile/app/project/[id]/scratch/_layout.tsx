import { Stack } from "expo-router";
import { StackPopTransition } from "../../../../components/StackPopTransition";
import { CONTAINED_POP_OVER_STACK_SCREEN_OPTIONS } from "../../../../lib/stack-pop";
import { useReduceMotion } from "../../../../lib/use-reduce-motion";

export default function ScratchStackLayout() {
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
      <Stack.Screen name="[noteId]" options={CONTAINED_POP_OVER_STACK_SCREEN_OPTIONS} />
    </Stack>
  );
}
