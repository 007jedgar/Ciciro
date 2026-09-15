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
      <Stack.Screen
        name="bible"
        options={{
          // Over the tabs rather than in place of them, so going back shows the
          // manuscript straight away and the bible collapses away over it. See
          // StackPopTransition: a pushed card detaches what is underneath, and
          // the collapse then plays against nothing.
          presentation: "transparentModal",
        }}
      />
    </Stack>
  );

  if (!projectId) return stack;
  return <ProjectProvider projectId={projectId}>{stack}</ProjectProvider>;
}
