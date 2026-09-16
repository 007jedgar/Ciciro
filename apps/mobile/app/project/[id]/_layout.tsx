import { Stack } from "expo-router";
import { useLocalSearchParams } from "expo-router";
import { StackPopTransition } from "../../../components/StackPopTransition";
import { CONTAINED_POP_OVER_STACK_SCREEN_OPTIONS } from "../../../lib/stack-pop";
import { ProjectProvider } from "../../../lib/project";
import { useReduceMotion } from "../../../lib/use-reduce-motion";

export default function ProjectStackLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const reduceMotion = useReduceMotion();
  const projectId = typeof id === "string" ? id : "";

  const stack = (
    <Stack
      screenLayout={({ children }) => <StackPopTransition>{children}</StackPopTransition>}
      screenOptions={{
        headerShown: false,
        animation: reduceMotion ? "fade" : "none",
        animationDuration: reduceMotion ? 140 : 320,
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="bible"
        // Over the tabs rather than in place of them, so going back shows the
        // manuscript straight away and the bible collapses away over it.
        options={CONTAINED_POP_OVER_STACK_SCREEN_OPTIONS}
      />
    </Stack>
  );

  if (!projectId) return stack;
  return <ProjectProvider projectId={projectId}>{stack}</ProjectProvider>;
}
