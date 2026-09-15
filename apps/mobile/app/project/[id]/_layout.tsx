import { Stack } from "expo-router";
import { useLocalSearchParams } from "expo-router";
import { StackPopTransition } from "../../../components/StackPopTransition";
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
      <Stack.Screen name="bible" />
    </Stack>
  );

  if (!projectId) return stack;
  return <ProjectProvider projectId={projectId}>{stack}</ProjectProvider>;
}
